---
"@objectstack/spec": minor
"@objectstack/runtime": patch
---

fix(spec,runtime): `resolveService` returns the slot's contract too, and the `: any` escapes on core slots are gone (#4127)

Batch 2 of the #4127 gate. #4168 typed `getService` — easy, because every one of
its call sites already passed a `CoreServiceName`. `resolveService` is the mixed
one, and it is where the remaining `any` lived.

**Overloads split it exactly where the evidence does.** A `CoreServiceName`
resolves to the slot's contract; anything else keeps `any`:

- **Core slots, however written.** 17 call sites address a core slot with a bare
  literal — `'metadata'` ×10, `'automation'` ×3, `'auth'` ×3, `'ai'` — rather
  than `CoreServiceName.enum.*`. The same slot was being addressed two ways;
  both resolve to the contract now, with no edit to the call sites.
- **Everything else** — `protocol` (×22), `objectql` (×9), `mcp`,
  `kernel-resolver`, `security`, `scope-manager`. Real services with no
  `CoreServiceName` entry and no written contract. They keep `any` rather than
  being given a shape here that nothing verifies: **that `any` is where the
  ledger honestly ends**, and writing those contracts is its own change.

**The typing was being erased at three call sites, and that is the actual
finding.** A `const x: any = await deps.resolveService('auth', …)` defeats every
bit of this — the annotation wins, and #4168's work does nothing there. Sweeping
for the pattern found three on core slots:

**`/mcp` ×2 — two more undeclared methods.** The domain calls
`authService?.getMcpResourceUrl?.()` and `?.getMcpResourceMetadataUrl?.()`.
`AuthManager` implements both (and plugin-auth uses them internally);
`IAuthService` declared neither. Classic #4127 shape — call site and
implementation agree, the contract is the thing nobody wrote.

The `: any` + optional-chaining combination made this *worse* than the earlier
gaps, not better: it made the call invisible to the type system **and**
accidentally safe. An absent method returns `undefined`, so the skill route
silently fell back to deriving an MCP URL from the request host — meaning a real
disagreement between the auth service's canonical value and the derived one
would have looked exactly like normal operation. The whole point of
`getMcpResourceUrl` is that it comes off the auth `basePath` so the two *cannot*
disagree about the API prefix; the route's own comment says "the auth service
owns the canonical value".

Both are declared optional: an auth provider without MCP/OAuth support fills the
slot legitimately, and `getMcpResourceMetadataUrl` returning `null` (OAuth track
off — AS disabled or the origin fails the OAuth 2.1 transport rule) stays
distinct from the method being absent.

**`/packages` ×1 —** `const metadata: any = await deps.getService(…metadata)`,
feeding `new SeedLoaderService(ql, metadata, …)`. Annotation dropped; it
typechecks against `IMetadataService` now. Its neighbours `protocol` and `ql`
keep their `any` for the honest reason above.

No other core-slot lookup is annotated away — the sweep is exhaustive over
`domains/*.ts`.

Verified: `@objectstack/runtime` **937 tests / 65 files**, `@objectstack/spec`
**7112 / 273** (3 new on the auth contract), adapter-hono **73**; `tsc --noEmit`
on spec, runtime, downstream-contract and all four examples; `pnpm lint`; all
nine `check:*` gates. `api-surface.json` is unchanged — the two additions are
interface MEMBERS, not new exports.
