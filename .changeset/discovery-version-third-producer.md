---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `getDiscovery()` serves a derived `version`, not the hardcoded `'1.0'` literal (#11235)

`ObjectStackProtocolImplementation.getDiscovery()` filled `DiscoverySchema`'s "System
Identity" `version` field with the constant `'1.0'`. The other `DiscoverySchema` producer
— `HttpDispatcher.getDiscoveryInfo()` in `@objectstack/runtime` — filled the *same* field
with its own constant `'1.0.0'` until #10993 derived it. Two producers of one field
disagreeing with each other is what proves neither literal was ever a contract value: if
`version` were a contract, two producers would not each invent their own constant; if it
is not, it should not be hardcoded. That argument needs no opinion about what `version`
"should" be.

It now resolves the same way its sibling does: an injected `OS_RUNTIME_VERSION` build
stamp, falling back to this package's own installed version, and `'unknown'` only if both
are unavailable — honest about not knowing rather than a plausible-looking constant. One
stamp, one meaning: a deployment that sets `OS_RUNTIME_VERSION` now gets the same answer
from both discovery producers and from `GET /health`, so the two can no longer drift.

The resolver is a package-local ~10-line copy of `packages/runtime/src/runtime-version.ts`
rather than a shared import: `@objectstack/runtime` depends on
`@objectstack/metadata-protocol`, not the reverse, so importing it would invert the
dependency direction, and hoisting a helper into `@objectstack/types`/`@objectstack/core`
would widen two packages' published surface for two call sites (declined at #11235
triage). `tsup.config.ts` gains `shims: true` for the same reason
`packages/runtime/tsup.config.ts` carries it — esbuild empties `import.meta` in a CJS
bundle, so without the shim `require('@objectstack/metadata-protocol')` would have fallen
through to `'unknown'` on every consumer.

No schema shape changed, no field was added, and no export was widened — only where one
field's value comes from. Patch, matching the sibling fix.
