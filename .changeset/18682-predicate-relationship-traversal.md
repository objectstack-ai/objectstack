---
'@objectstack/formula': minor
'@objectstack/lint': minor
'@objectstack/objectql': minor
'@objectstack/plugin-security': minor
---

A validation rule can read one hop through a lookup — `record.account.type` on an opportunity resolves the owning account's field instead of faulting (#18682)

Clause-②: yes (widening)

A validation predicate could only read the record it guards. A `lookup` /
`master_detail` field carries an **id**, so the natural cross-object rule —
"a partner account may not carry an opportunity over 10000" — faulted with
`runtime: No such key: type`, and because a broken validation is fail-closed it
rejected every write on the object. The capability mainstream platforms provide
as a matter of course could not be authored at all.

### What you can write now

```ts
validations: [{
  name: 'partner_cap',
  type: 'script',
  message: 'Partner accounts are capped at 10000.',
  condition: "record.account.type == 'partner' && record.amount > 10000",
}]
```

One hop, through any reference-typed field (`lookup`, `master_detail`, `user`,
`tree`). The engine reads the related row before evaluating and binds it in
place of the id, so `record.<reference field>.<field>` resolves.

### It is data pinned BEFORE evaluation, not a query from inside CEL

There is no `os.lookup(...)` / `os.exists` / `os.count` — those stay removed.
The engine statically analyses the predicate, learns exactly which reference
fields it reads through and which related fields it names, and loads those
**before** evaluation. Every registered function stays pure once `now` is
pinned, so `objectstack build` artifacts stay byte-stable.

The cost is bounded by construction: one hop, only the fields a rule actually
names, one batched read per reference field per write, and nothing at all when
no rule traverses.

### Read authority — system, bounded by the projection

The related row is read under **system authority**. A validation rule's output
is a pass/fail the *system* enforces, not data handed to the caller — which is
why RLS predicates are excluded from this capability altogether. Reading as the
acting user instead made the rule unauthorable for exactly the persona it exists
to constrain: a member with CRUD on the child and no read on the parent faulted
on every write.

What bounds the elevation is the **projection**, not the caller: only the
columns the predicate names, intersected with the related object's declared
fields. A column the related object does not declare never enters the query, and
is refused as the authoring fault it is — distinct from a column that exists and
is empty, which evaluates as `null`.

⚠️ **The accepted cost, stated plainly.** A caller can *infer* a related value
they cannot see by observing which writes are refused. The value itself never
appears — the refusal names the field and the rule, never the value — and the
channel is deliberately no wider than "this rule refused this write".

### Two shapes are refused at authoring time, with a prescription

Both fault at evaluation today, so neither removes anything that works:

| Shape | Why | Write instead |
| --- | --- | --- |
| `record.account.type == 'x' && record.account == 'acc_1'` | reading through the relationship resolves `record.account` to the related RECORD, so the id comparison would stop matching — silently | `record.account.id == 'acc_1'` for the value comparison |
| `record.account.owner.email` | a second hop is not loaded | denormalise onto `account`'s object, or read it in a hook |

A field that is **not** reference-typed is untouched: `record.address.city` on
an object-valued field traverses today and keeps traversing.

### `@objectstack/plugin-security` gains `canWriteObject`

The WRITE admission — the sibling of the existing `canReadObject`, running the
middleware's own arms in the middleware's own order: system bypass; then, before
anything resolves, the ADR-0103 engine-owned write guard and the ADR-0090 D12
delegated-administration gate, each called as the middleware's own primitive;
then no resolved permission sets, unresolvable posture, the ADR-0066 D3
`requiredPermissions` capability AND-gate for both principals, the CRUD grant,
the ADR-0090 D10 delegator check, and — when the caller's payload is supplied —
the field-level security WRITE gate over it (`getFieldPermissions`, folded
through the D3 field-capability contract, intersected with the delegator's mask
under D10, then the forbidden-write detection). It exists for doors that must ask
"could this caller perform this write" without running the engine middleware —
the write preview is the first — and an equivalence suite pins its answer EQUAL
to the registered middleware's, case for case AND payload for payload, so the
two cannot drift.

⭐ What it answers, POSITIVELY — by naming what it RUNS, never a category of the
write decision: the ADR-0103 engine-owned affordance gate, the ADR-0090 D12
delegated-admin gate, the fail-closed postures, the ADR-0066 D3 capability
AND-gate for both principals, the `allowCreate`/`allowEdit` CRUD grant, the D10
delegator's independent grant, and the step 2.5 FLS write gate over the keys the
payload names — each pinned EQUAL to the registered middleware's, arm for arm.
It says nothing about any refusal not in that list.

⛔ `true` never means the write will succeed, and ⛔ what follows is not an
enumeration of the distance to success: the middleware refuses both before and
after `next()` for reasons this method is never asked. Nearest to hand are the
remaining pre-resolution gates that run beside the two named above — the
package-managed and system-row write gates, which judge a row's PROVENANCE; the
curated-capability-name and audience-anchor binding refusals, which judge a
payload VALUE; and the ADR-0056 public-form grant, which no caller can present
to this method and which has no extracted primitive to call; the row-level and
post-image refusals — the `using` pre-image, the ADR-0055 controlled-by-parent
master edit, the RLS `check` post-image and the Layer 0 tenant post-image, none
of which this method can judge because it is asked about no ROW; the
payload-VALUE refusals the same caller passes by simply not sending the value —
the masked echo and the `owner_id` forge, which therefore widen the caller class
by nothing; the anti-filter-oracle guard on the caller's own predicate, which
this method is handed none of; the post-`next()` assertion that the insert
`check` seam really ran, which judges an executed write; and, outside the
middleware entirely, `readonlyWhen`, the static `readonly` strip and the
validation rules themselves.

### Scope

Object validation rules (`script` / `cross_field`) — and the system-authority
read is confined to that one seam. The field-level
`requiredWhen` / `readonlyWhen` / option `visibleWhen` predicates fail **open**
and are deliberately not covered here; RLS predicates are out too. Depth is one
hop.
