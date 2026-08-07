---
"@objectstack/plugin-auth": minor
"@objectstack/runtime": patch
"@objectstack/service-sms": patch
---

feat(plugin-auth): the fixed-window counter gets its own `./rate-limit-storage` entry (#6040)

`rate-limit-storage.ts` is the repo's ONE fixed-window counter —
`incrementFixedWindow` / `createLazyCounterStore` / `InProcessCounterStore`,
ADR-0069 D2 — and #4790's cross-reference asks later arrivals to reuse it
rather than write a third copy. They did, and from outside auth:
`@objectstack/runtime` counts inbound requests and endpoint policy through it,
and `@objectstack/service-sms` counts its daily SMS budget through it (#2814).

`@objectstack/plugin-auth` published exactly one entry, `"."`, whose `export *`
chain takes **value** imports on `better-auth/adapters`
(`objectql-adapter.ts`) and `@better-auth/core/db` (`backfill-account-issuer.ts`).
Value imports are evaluated eagerly, so reaching those ~90 lines of counting
loaded `better-auth` + `@better-auth/{core,oauth-provider,scim,sso}` + `jose` +
`@noble/hashes` + `@objectstack/rest` + `@objectstack/platform-objects` first.
Measured against the built package: `require('@objectstack/plugin-auth')` puts
109 modules in `require.cache`; the counter needs one.

So the counter is now published on its own:

```ts
// before — 109 modules, the whole better-auth family
import { incrementFixedWindow } from '@objectstack/plugin-auth';
// after — 1 module, 3.7 KB
import { incrementFixedWindow } from '@objectstack/plugin-auth/rate-limit-storage';
```

`tsup` emits the second entry with `splitting: false`, so it is a self-contained
bundle rather than a nominal split: `dist/rate-limit-storage.mjs` is 3.71 KB
against `dist/index.mjs`'s 330.28 KB, contains zero top-level imports and zero
occurrences of the string `better-auth`. The one better-auth reference that
survives is `import type { BetterAuthRateLimitStorage }`, which is erased at
build and costs a consumer nothing at runtime.

**Nothing is removed.** The root still re-exports every one of these symbols, so
existing `@objectstack/plugin-auth` imports keep working unchanged — this is a
new entry point, which is why it is `minor` rather than breaking. The `patch` on
`runtime` and `service-sms` is the import-specifier switch in those packages;
their behaviour is identical.

`src/rate-limit-storage-isolation.test.ts` pins the invariant from both sides,
in the shape `packages/types/src/node-isolation.test.ts` (#4700) established for
the `./node` split: it walks the real import graph from the subpath entry and
fails on any better-auth **value** import or any undeclared external package,
it fails if a consumer reaches the counter through the package root again, and
it fails if the root ever *stops* pulling better-auth eagerly — because at that
point the split stopped buying anything and deserves re-measuring rather than a
suite that passes for the wrong reason.
