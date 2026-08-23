---
"@objectstack/runtime": minor
"@objectstack/rest": patch
---

`KernelResolver` gains an optional environment-only member so a REST request
pays ONE kernel-waiter window instead of two (#10988).

`RestApiPlugin` wraps the host's ADR-0006 `kernel-resolver` so `RestServer` can
ask "which environment is this request in?". It asked `resolveKernel` — a
kernel-ACQUISITION api — and kept only `context.environmentId`. A host resolver
writes the id and then awaits that environment's kernel, so the wrapper paid a
full waiter window and discarded what it bought; `resolveProtocol` then acquired
the kernel again. Free on a warm environment (a cache hit, which is why this was
invisible), a second serial wait on a cold or wedged one. Measured on a live
multi-tenant host with `waiterTimeoutMs: 20s`: REST-owned routes
(`/api/v1/discovery`, `/api/v1/data/:object`) answered 503 after ~42s where
dispatcher-owned routes answered after ~21s.

`KernelResolver.resolveEnvironment?(context, defaultKernel)` resolves ONLY the
request's environment onto the context, acquiring no kernel; the REST wrapper
prefers it when the host implements it, leaving `resolveProtocol` as the single
kernel-acquisition point on the path.

**Non-breaking, and no flag day.** The member is `?.`-optional: a host that
implements only `resolveKernel` type-checks and behaves exactly as before (it
keeps paying the discarded acquisition on cold builds), so this ships before any
host implements the new half. Adding an optional member to an interface the
framework CONSUMES cannot invalidate an existing implementation — every resolver
already in the field still satisfies the contract. Marked `minor` on
`@objectstack/runtime` because it is a new public capability on an exported
contract, `patch` on `@objectstack/rest` because the wrapper change is a fix
with no surface of its own.

Fail-closed is unchanged and pinned: the surviving `getOrCreate` still rejects
for a genuinely unavailable kernel, so the caller still gets the host's declared
503 — a shorter wait to the same verdict, never a response served against no
kernel. `waiterTimeoutMs` is a host setting and is untouched; the defect was
waiting twice, not waiting wrong.
