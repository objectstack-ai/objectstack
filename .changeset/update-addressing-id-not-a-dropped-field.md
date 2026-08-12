---
"@objectstack/objectql": patch
"@objectstack/spec": patch
---

fix(objectql): a single-record update no longer reports the addressed row's own primary key as a dropped field (#8093)

`droppedFields` / `onFieldsDropped` has one declared meaning: fields the CALLER
SUPPLIED and the engine REFUSED. On the by-id branch a payload `id` that equals
the row the call is bound to is the write's ADDRESS, not part of its payload —
it was refused nothing — and it was being reported as a `readonly` drop on every
object that declares `id` as `readonly: true`, which is every platform object.

**Measured through the real ingress before fixing anything**, because the
report's own premise was an inference off the client source rather than a wire
capture. A real `ObjectQL` + a real `ObjectStackProtocolImplementation`, driven
with a body that provably has no `id` key
(`hasOwnProperty(body,'id') === false`, body keys `["value"]`):

```
PATCH /data/sys_user_preference/4mekbFDEhx0QgC85   body: {"value":[…]}
→ 200  droppedFields:[{object:"sys_user_preference",fields:["id"],reason:"readonly"}]
```

The server manufactures the key the caller never sent. `metadata-protocol`'s
`updateData` folds the path id INTO the write payload (`{ ...request.data, id:
request.id }`, #6479 — so a body `id` cannot bind a row other than the one the
URL, the `If-Match` check and the receipt all name). That fold is correct and is
unchanged here; it simply lands in `data` BEFORE the engine snapshots
`suppliedValues`, after which the address is indistinguishable from something
the caller typed, and the static-`readonly` strip (#2948) drops and reports it.

**The cost was not cosmetic, which is why this is worth a round.** The console's
internal "recent items" trace runs on every org switch, so every org switch
popped a user-facing amber warning toast naming a field the user never touched.
The damage is that the warning channel gets TRAINED TO BE IGNORED — a user who
learns the amber toast is noise will ignore the one that matters. The identical
failure mode is already on record one field over: #3431 / #3794 stopped
`userState.ts` sending `updated_at` because doing so "made every
recents/favorites write pop a scary warning about a field the user never
touched, drowning the real signal the toast exists for."

**This narrows the REPORT, not the strip.** `id` still leaves the SET clause and
must: a same-value primary-key write is a harmless no-op on SQL but an outright
rejection on stores with immutable primary keys, and #6435's block already ruled
that widening the strip to the truthy-scalar case "is a separate decision, not a
rider here". The payload handed to the driver is byte-identical before and
after — pinned in both test files.

**Scope, self-enforced by construction.** The exclusion is keyed on equality
with the BOUND key, so it reaches only single-record update: a predicate/multi
write addresses nothing by key and still reports a caller-supplied `id` in full,
and the `primary_key` strips (#6437) cannot collide with it, since those fire
only when the dispatch has already RULED the value is not an identifier —
exactly when it cannot equal the bound key.

⚠️ **`strictReadonlyWrites` moves with it, and that is the contract rather than
a side effect.** The option covers "every drop `onFieldsDropped` reports" —
coverage DERIVED from the reported set (#6437) — so a non-drop must not be a
refusal either. A strict caller doing a single-record update of a platform
object previously got `ERR_READONLY_FIELD_REJECTED` for its own row's address,
and a strict refusal for a genuinely forged read-only field previously listed
`id` beside it in `drops`. Both are corrected. The reverse verification measured
this directly: reverting the report also restores the refusal — the quiet and
loud halves cannot move apart.

The invariant is now stated where the next reader looks for it —
`WriteObservabilityOptions` in `spec/src/contracts/data-engine.ts` — including
what is deliberately still reported, so the boundary is not re-derived from the
implementation next time.
