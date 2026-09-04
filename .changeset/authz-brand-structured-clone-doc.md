---
'@objectstack/core': patch
---

docs(core): the `AuthzStoreUnavailableError` brand doc states the measured `structuredClone` behaviour instead of claiming survival (#14006)

Documentation only — no runtime change, no type change, no accept/reject
behaviour moves. It ships as a patch because the docblock is a **published
byte**: `tsup`'s declaration rollup carries it into `dist/index.d.ts` and
`dist/index.d.cts`, so it is what a consumer reads on hover.

The brand's docblock justified the string-keyed own property with two reasons
joined by an `and`, of which only the second was true:

> A string-keyed own property (not a `Symbol.for` registry key) so it survives
> `structuredClone`, and so a duplicated copy of this module still brands
> identically.

Measured on Node 22.22.2: the structured-clone algorithm gives `Error` a
dedicated serialization carrying `message`, `stack` and `cause` only, and drops
every other own property — the brand, the ADR-0112 `code`, `status` and
`object` alike (a subclass's own `name` returns as `'Error'`). The
plain-object control is the half that proves it: `{ __brand: true, code: 'C' }`
keeps **both** keys through the same call, so the loss is specific to `Error`,
not general to `structuredClone`.

The property and the reason that actually earns it are kept — a duplicated copy
of the module still brands identically, which is exactly what `instanceof`
cannot do across two installed copies of `@objectstack/core`. The false half is
replaced by the measured behaviour, carrying the reproducible script and the
Node version rather than a second unsourced assertion, and phrased to match
what `service-not-registered.ts` already records for its own brand (one
phrasing across the two modules, not two).

⛔ The clone gap is deliberately NOT "fixed" with a `toJSON` or a custom
serialization: no call site crosses a clone boundary today
(`rethrowAuthzStoreUnavailable` on the rest rethrow paths,
`isAuthzStoreUnavailableError` inside service `catch` blocks — all in-process),
and adding one would widen the module's surface with nothing pulling on it. The
docblock instead names the trap the false claim invited: branching on the brand
across a worker or `postMessage` boundary would answer `false` and fail OPEN on
a security path.
