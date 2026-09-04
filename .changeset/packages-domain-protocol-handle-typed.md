---
"@objectstack/runtime": patch
---

fix(runtime): the packages domain reaches the `protocol` service through a typed handle (#13598)

`deps.resolveService(context, 'protocol')` answers `any` — `protocol` is
deliberately left unmapped in `ServiceSlotContracts` — so every request literal
downstream of that seam compiled against nothing. Twelve sites in
`domains/packages.ts` held that `any` (two of them on the variable declaration
rather than the call), and an undeclared or misspelt key in the ADR-0045
publish-visibility flip's `getMetaItems` / `saveMetaItem` literals compiled
silently. Measured on the base tree: injecting `bogusUndeclaredKey: true` into
the `saveMetaItem` literal gave `tsc --noEmit` exit 0 and zero diagnostics.

The slot is now narrowed once, at one helper, to a handle `Pick`ed from the
DECLARED contracts — `MetadataProtocol` / `PackageProtocol` from
`@objectstack/spec`, plus the producer's own exported `DeletePackageRequest` —
so the same injection is now `error TS2353`. Every member is OPTIONAL and every
`typeof protocol.<verb> === 'function'` capability probe is unchanged: a host
may occupy the slot with a partial object, and the type answers "is this key
declared?" while the probe still answers "did this host bring the verb?".

Compile-layer signal only — no request is newly accepted or refused, no
response shape moves, and the eight verbs no contract declares keep an explicit
`any` request rather than a private restatement nothing verifies.
