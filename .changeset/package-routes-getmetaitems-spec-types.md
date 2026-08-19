---
"@objectstack/rest": patch
---

refactor(rest): `package-routes`' `protocol.getMetaItems` option reads the spec's declared request/response instead of a hand-rolled local shape (#9846)

`PackageRoutesOptions.protocol` declared its meta-read verb as a local
structural type — `getMetaItems?(req: { type: string }): Promise<{ items: any[] }>`
— rather than naming the shapes `packages/spec` already declares. Nothing was
broken by it: both call sites send exactly `{ type: 'package' }`, which is a
valid `GetMetaItemsRequest`, and both read `result?.items` defensively.

What it was, is the same blindness class one level up from the sibling
meta-read doors: a request type *re-stated locally* rather than *read from the
spec* lets the contract move underneath this module — a narrowed `type`
vocabulary, a newly required member, a renamed key — while the file keeps
compiling green against a shape the protocol no longer has.

Both are now sourced from `@objectstack/spec/api`:

```ts
getMetaItems?(req: GetMetaItemsRequest): Promise<GetMetaItemsResponse>;
```

**The optionality and the runtime feature-detection are deliberately kept.**
`MetadataProtocol` declares `getMetaItems` as a **required** member, while this
option is optional and both call sites guard with
`typeof … === 'function'`. Adopting `MetadataProtocol` whole would change what
the seam tolerates — a behaviour question, deliberately not answered here.

Naming the declared response surfaced one thing the local `any[]` had been
hiding: the spec types `items` as `unknown[]`, because it says nothing about
what a metadata item *contains*. The registry-specific keys this module reads
off each entry (`manifest.id`) are not spec-declared, so the **element** read
stays runtime-shaped on purpose — the same disposition the sibling doors take
via `metaItemsArray`. The seam is typed; the element read is coerced at the
read and unchanged in behaviour.

A compile-time pin holds the coupling: an exact type-equality assertion that
the option's request/response types are still the spec's, so re-hand-rolling
the local shape fails the build rather than passing unnoticed. It lives in
compiled source rather than a test file, because this package's `tsconfig.json`
excludes its test files and no sibling gate type-checks them — a type-level
assertion written there would be compiled by nothing.

`deletePackage`'s local structural type is untouched: no declared spec shape
exists for that verb, and minting one is a contract act rather than a typing
cleanup.

Internal typing only — `PackageRoutesOptions` is not exported from the
package's entrypoint, so no public surface changes and no route changes what it
accepts or rejects.
