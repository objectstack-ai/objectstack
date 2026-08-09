---
"@objectstack/http-conformance": minor
---

test(http-conformance): the `setFallbackHandler` seam's four guarantees are asserted cross-adapter — and the reference adapter implements them

`IHttpServer.setFallbackHandler` (`packages/spec/src/contracts/http-server.ts`,
#5040 §1-C) declares four testable guarantees, and `@objectstack/http-conformance`
— the cross-adapter guard those semantics name by hand — asserted **none** of
them. Since the #5111 flip this seam is the ONLY entry path for declarative
`apis:` endpoints, so a second adapter diverging here does not mean cosmetic
drift, it means "declarative endpoints behave unpredictably on that adapter".

Two changes, in the only order that works:

1. **`NodeHttpServer` gains the member.** `node:http` ships no not-found hook to
   map onto, so this adapter builds the equivalent out of its own router: the
   handler is a FIELD consulted in the route-miss branch, never a
   `${prefix}/*` catch-all route (which would be decided by first-match-wins
   registration order — the ADR-0076 D11 hazard). 405 + `Allow` keeps
   precedence over the fallback, and a fallback that writes nothing falls
   through to the adapter's own unmatched answer unchanged.
2. **`fallback-seam.conformance.test.ts` transcribes the four guarantees** and
   runs them against BOTH adapters over a real socket — `NodeHttpServer` and
   `HonoHttpServer`, same cases, no adapter-conditional branches. Nine cases
   per adapter.

**Why `minor`, and why only this package.** The bump is a new capability on a
published-nothing QA harness: `NodeHttpServer` grew a contract member it did not
have, which is additive API surface on this package, so `minor` rather than the
`patch` the test file alone would earn. No other package is named because none
changed — `packages/spec`'s contract is untouched (the four guarantees were
already declared; this asserts them), and `HonoHttpServer` needed no change to
pass all nine, which is itself the finding: Hono violates none of the four.

**Observation-class, not a live defect.** Only `HonoHttpServer` implements the
member today, and the reference adapter's previous non-implementation was
*compliant* — the member is optional on the contract. This closes a latent gap
before a second implementor exists to fall through it, which is the only moment
the coverage is cheap.
