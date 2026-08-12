---
"@objectstack/objectql": patch
---

fix(objectql): the read-only strip stops warning that the addressed row's own `id` was a forged caller write (#8141)

Every single-record update of every platform object emitted a server WARN whose
three claims were all false for that write:

```
Field 'id' on 'sys_user_preference' is read-only: the caller-supplied value was
DROPPED and the update is being COMMITTED WITHOUT IT — …
```

Measured with `updateData({ object: 'sys_user_preference', id: 'rec_1', data: { value: ['x'] } })`
— a body carrying no `id` key at all. The value was not caller-supplied: the
REST ingress folds the path id into the payload so a body `id` cannot bind a row
other than the one the URL, the OCC check and the receipt all name (#6479), and
that fold lands before the engine's caller snapshot. Nothing the caller wanted
was dropped, and nothing it asked for was left out of the commit. Worse, the
message's remedy told that caller to pass `{ context: { isSystem: true } }` —
which would exempt it from the read-only strip **entirely**, a strictly worse
posture bought to silence a line that should never have printed.

Volume is the damage: it fired on every single-record `PATCH` of every object
declaring `id` as `readonly: true`, which is every platform object (the console's
recents trace alone emits one per org switch). The line is deliberately kept at
`warn` so **real** forgery attempts stay visible, and a warning that fires on
every ordinary write trains its reader to skip the channel. This is the log-side
half of the amber toast #8093 removed.

`stripReadonlyFields` now takes an `addressKey` option naming the key that
carries the write's address; that key is still **stripped**, it just no longer
logs. The by-id update branch supplies it from the same `idAddressesThisRow`
predicate #8093 wired to `droppedFields` / `onFieldsDropped`, so the log and the
report channel cannot disagree about what an address is.

**Unchanged, deliberately:** the strip itself — `id` still never reaches the
driver's SET clause, and the payload handed to every driver is byte-identical
(a same-value primary-key write is a no-op on SQL but an outright rejection on
stores with immutable primary keys). Any other read-only field a caller really
did forge still warns, byte-identical in wording and still at `warn`. A payload
`id` the engine has ruled is not a primary key still gets its own `primary_key`
diagnostic. Predicate/multi updates and the insert-side strip pass no address at
all and behave exactly as before. `strictReadonlyWrites` refusals are untouched:
they are derived from the report channel, which already excluded the address.
