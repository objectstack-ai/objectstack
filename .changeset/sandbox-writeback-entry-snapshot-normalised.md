---
'@objectstack/runtime': patch
---

fix(runtime): a sandboxed hook body no longer launders an untouched `readonly` field onto the row

A `beforeUpdate`/`beforeInsert` body running in the sandbox made the engine believe it had
written payload keys it never named, and a `readonly` field the caller supplied then survived
the readonly strip and landed. Measured end to end: with `locked_at` declared
`{ type: 'datetime', readonly: true }` and seeded to `2020-01-01`, a caller sending
`locked_at: new Date('2099-12-31…')` alongside a body whose whole source is
`ctx.input.touched_by = 'hook'` stored the caller's 2099 value — while the same object's
readonly `text` field was correctly stripped in the same request.

The cause was a comparison of unlike things. The write-back decides whether a body wrote
*through* an object-valued key by comparing the host payload value against the VM's exit dump,
and the dump has been through `JSON.stringify`/`JSON.parse` while the host value has not. A
`Date` therefore never compared equal to its own ISO projection, took the documented
"cannot prove equal ⇒ carry it back" path, and was re-asserted onto the proxy that records
which keys a hook wrote. The class was every object-valued value a JSON round-trip cannot
prove equal — an object carrying an `undefined` member included, a `Date` being only its most
reachable member.

The entry value is now normalised through the same round-trip the VM saw before it is
compared. The same change ends a fidelity loss on non-readonly fields: an untouched key is no
longer carried at all, so a host `Date` is no longer replaced by an ISO string on its way to
the driver.

Fail-open behaviour is unchanged for values the round-trip genuinely cannot evaluate: a cyclic
or bigint-bearing payload value is still reported as changed and still carried, per key.
