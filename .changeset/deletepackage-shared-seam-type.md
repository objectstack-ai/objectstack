---
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

refactor(metadata-protocol,rest,runtime): one declared shape for the `protocol.deletePackage` seam, imported by both doors (#9960)

`deletePackage` had **three** independent statements of its own contract, and
they did not agree:

| site | what it said |
|---|---|
| `packages/metadata-protocol/src/protocol.ts` (the producer) | an inline structural type on the method — `packageId`, `organizationId?`, `allTenants?`, `actor?`, `keepData?` |
| `packages/rest/src/package-routes.ts` (direct-mount option) | `{ packageId; actor?; allTenants? }` — named **neither** `organizationId` **nor** `keepData`, and its response omitted `deleted` |
| `packages/runtime/src/domains/packages.ts` (dispatcher twin) | nothing at all — it reached the verb through `(protocol as any)` |

The twin routinely sent exactly the two keys the REST option's type could not
express, and the only reason that was not a compile error was the cast.

`organizationId` is the member that makes this load-bearing rather than
cosmetic: the protocol refuses a call naming neither it nor `allTenants`
(`TENANT_SCOPE_REQUIRED`, 400), so it is precisely the key whose presence
decides an uninstall's blast radius — and it was the key one of the two doors
had no word for.

**What changes:** `DeletePackageRequest` and `DeletePackageResponse` are
declared once at the producer and exported from `@objectstack/metadata-protocol`
(the only user-visible half of this change — two additive type exports); both
consumers import them, and the `as any` seam is gone. `@objectstack/rest` also
gains three compile-time pins over its option, in compiled source rather than a
test file, so a later hand-rolled restatement fails `tsc` instead of drifting
green.

**What does not change:** nothing about what the verb accepts or returns. The
members are identical to the ones the implementation already had, the live call
sites send the same keys, and the emitted JavaScript of both consumers is
unchanged. The member stays optional at both seams and the runtime's
`typeof … === 'function'` capability probe stays — the `protocol` service slot
is deliberately uncontracted, the spec's `PackageProtocol` does not declare this
verb, and registrants carrying no `deletePackage` are real.

No `packages/spec` declaration: minting protocol surface for a verb with zero
external consumers is a spec-seat decision nobody has asked for.
