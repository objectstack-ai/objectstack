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
middleware's own arms in the middleware's own order: system bypass, no resolved
permission sets, unresolvable posture, the ADR-0066 D3 `requiredPermissions`
capability AND-gate for both principals, the CRUD grant, the ADR-0090 D10
delegator check, and — when the caller's payload is supplied — the field-level
security WRITE gate over it (`getFieldPermissions`, folded through the D3
field-capability contract, intersected with the delegator's mask under D10, then
the forbidden-write detection). It exists for doors that must ask "could this
caller perform this write" without running the engine middleware — the write
preview is the first — and an equivalence suite pins its answer EQUAL to the
registered middleware's, case for case AND payload for payload, so the two
cannot drift.

⛔ `true` never means the write will succeed. What is still ahead of it, by
name: the row-level pre-image (this method is asked about no ROW, and without a
payload about no FIELD either), `readonlyWhen`, the static `readonly` strip, and
the validation rules themselves.

### Scope

Object validation rules (`script` / `cross_field`) — and the system-authority
read is confined to that one seam. The field-level
`requiredWhen` / `readonlyWhen` / option `visibleWhen` predicates fail **open**
and are deliberately not covered here; RLS predicates are out too. Depth is one
hop.
