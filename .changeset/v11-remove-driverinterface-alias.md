---
"@objectstack/spec": minor
"@objectstack/core": minor
"@objectstack/objectql": minor
---

Remove the deprecated `DriverInterface` type alias — use `IDataDriver` (11.0).

`DriverInterface` was a `@deprecated` alias of `IDataDriver` (the authoritative
driver contract). It is removed from `@objectstack/spec/contracts` and
`@objectstack/core`; `objectql`'s engine now types drivers as `IDataDriver`
directly (a type-identical change, since the alias *was* `IDataDriver`).

Driver authors: replace `DriverInterface` with `IDataDriver` (same shape).

Note: this is unrelated to the live `IDataEngine` interface (engine-layer
contract, not deprecated) and to the separate zod-derived `DriverInterface` /
`DriverInterfaceSchema` in `@objectstack/spec/data` (the runtime driver schema),
both of which are unchanged.
