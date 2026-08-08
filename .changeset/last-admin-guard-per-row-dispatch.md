---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): keep the last-administrator guard exact when `before*` hooks fire per row (#5574)

The break-glass guard resolved a write's target set as "a scalar `input.id` if
there is one, otherwise the caller's predicate". That was sound only because a
predicate (`multi: true`) write's `before*` dispatch left `input.id`
present-but-**undefined**. ADR-0058 Addendum II makes the `before*` phase fire
once per MATCHED ROW, each context naming its own row — so read that way, a
`multi` ban of every administrator arrives as N separate by-id bans, each of
which is legitimately allowed (banning one admin out of three leaves two), and
the batch locked the environment out with no refusal anywhere.

`resolveTargetIds` now asks `options.multi` FIRST: on a predicate write the
target set is the caller's predicate, whichever row the current dispatch names;
the id is consulted only when the write really is by-id. `input.options` is the
caller's bag during `before*` — `where` and `multi` included — and the contract
preserves that deliberately, so the discriminator the guard needs is unchanged.

All eight guarded halves (#5892 ban, #5941 delete, #5978 standing) are covered
by the existing predicate cases, which went red on the engine change and are now
the pin that a population-scoped invariant survives being asked one row at a
time.
