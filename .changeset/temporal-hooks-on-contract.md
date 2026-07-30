---
"@objectstack/spec": minor
"@objectstack/service-analytics": patch
---

feat(spec): promote the temporal storage hooks onto the IDataDriver contract (ADR-0053 D-A2)

`temporalFilterValue` and `temporalFilterColumnSql` — the pair that closed
#3912's storage-form drift — were duck-typed: analytics probed
`typeof driver.x === 'function'` against a locally-invented interface, and
nothing at the type level said a driver must implement both or neither. The
lesson of #3912 is precisely that coercing the comparand without normalising
the column reintroduces half the bug, so a driver implementing one hook alone
would silently regress.

Both are now optional members of `IDataDriver`
(`@objectstack/spec/contracts`), documented as a pair with "absent = identity"
semantics for drivers whose storage form is the wire form (memory, mongo).
`SqlDriver implements IDataDriver`, so its signatures are compile-checked from
here on; analytics derives its driver seam by `Pick`-ing the contract instead
of a local duck type. Runtime `typeof` guards remain — that is the correct way
to consume an optional contract member — but the shape they guard now has one
authoritative definition.

No runtime behaviour change. ADR-0053 D-A2 is recorded as resolved.
