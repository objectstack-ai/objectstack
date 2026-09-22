---
'@objectstack/formula': minor
'@objectstack/objectql': minor
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

### Permission semantics — absent, loudly

The related rows are read under the **acting user**, through the engine's own
read path, so the referenced object's CRUD gate, RLS and FLS all apply. A row
or a field the caller may not read therefore does not arrive: the stored id
stays, the traversal faults, and the write is **rejected**. A rule that guards
data the caller cannot see never silently passes — and never silently fails
either.

### Two shapes are refused at authoring time, with a prescription

Both fault at evaluation today, so neither removes anything that works:

| Shape | Why | Write instead |
| --- | --- | --- |
| `record.account.type == 'x' && record.account == 'acc_1'` | reading through the relationship resolves `record.account` to the related RECORD, so the id comparison would stop matching — silently | `record.account.id == 'acc_1'` for the value comparison |
| `record.account.owner.email` | a second hop is not loaded | denormalise onto `account`'s object, or read it in a hook |

A field that is **not** reference-typed is untouched: `record.address.city` on
an object-valued field traverses today and keeps traversing.

### Scope

Object validation rules (`script` / `cross_field`) — the seam that is
fail-closed, and therefore the only one where an unreadable related field can
produce the loud refusal the permission rule above requires. The field-level
`requiredWhen` / `readonlyWhen` / option `visibleWhen` predicates fail **open**
and are deliberately not covered here; RLS predicates are out too. Depth is one
hop.
