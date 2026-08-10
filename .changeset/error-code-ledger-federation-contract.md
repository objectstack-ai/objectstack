---
"@objectstack/spec": minor
---

feat(spec): the error-code ledger states its federation contract; `makeApiErrorSchema(extraCodes)` (#4805)

`ERROR_CODE_LEDGER` registers framework packages only. That was true of every
row in it and stated nowhere — a reader could only infer it by scanning the
package names, which is exactly what a downstream product repo did not do
before filing #4805. It is now a stated rule in the file header, together with
what a downstream repo does instead.

**The rule.** A product repo built on the platform (`objectstack-ai/cloud`, or
any other) does not register its codes here. It maintains its own ledger, in
its own repo, and composes the validation itself: `envelopeViolations(body)`
for the shape, and `code ∈ StandardErrorCode ∪ <its own ledger>` for the
vocabulary. The deployed wire vocabulary stays closed and checkable either way,
which is what ADR-0112's "no silent fourth state" asks for — it never asked for
every entry to live physically in one file. The header also records why the
ruling went this way rather than admitting downstream entries: a commercial
vocabulary (billing states, plan gating, control-plane provisioning refusals)
does not belong in an Apache-2.0 spec enumerating package names absent from
this distribution, and a cross-repo PR plus a pin bump per code is friction
that pushes authors toward reusing a semantically wrong existing code — less
visible than inventing one.

**`ApiErrorSchema.code`'s description follows the same seam.** It said
`StandardErrorCode ∪ ERROR_CODE_LEDGER`; it now says `StandardErrorCode` ∪ the
ledger the serving side registers, naming `ERROR_CODE_LEDGER` as the framework
packages' one. Description only — the parsed vocabulary is unchanged.

**New export: `makeApiErrorSchema(extraCodes)`.** The envelope with a
caller-supplied vocabulary — `StandardErrorCode ∪ extraCodes` — so a downstream
conformance suite gets one verdict with a Zod issue path instead of a shape
assertion plus a hand-written membership test:

```ts
const CloudApiError = makeApiErrorSchema(CLOUD_ERROR_CODES);
CloudApiError.safeParse(body);   // shape + vocabulary, one parse
```

The envelope shape is `ApiErrorSchema`'s, reused rather than restated, so a
field added to the base envelope reaches every downstream ledger with it.
`ERROR_CODE_LEDGER`'s own entries are deliberately not folded in: a service
that also relays framework-produced errors says so explicitly by passing them
(`makeApiErrorSchema([...REGISTERED_ERROR_CODES, ...MY_CODES])`).

Additive throughout. `ApiErrorSchema` parses exactly what it parsed before — an
extra code is accepted only through the factory, and a code neither standard
nor supplied is still refused by both. Federating the ledger does not open the
vocabulary; it moves where the other half of it is declared.
