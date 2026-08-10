---
"@objectstack/spec": minor
"@objectstack/core": minor
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

feat: declare `ExecutionContext.authGate`, so the ADR-0069 gate sits inside the closed field set (#7280)

The ADR-0069 authentication-policy gate (expired password, enforced MFA) rode
the execution context **undeclared**: REST's `computeExecCtx` spread it onto the
assembled envelope with `...(authGate ? { authGate } : {})` behind an `as any`,
and its `enforceAuth` read it back ten lines later. Nothing was broken — but the
closed entry field set shipped in #6216 is derived from `keyof ExecutionContext`,
so a field that exists only inside an `as any` is **outside every closure gate by
construction**: `ENTRY_EXECUTION_CONTEXT_FIELDS` could not list it,
`ExecutionContextEntryFields` could not demand it, and the runtime pin that
reconciles the closed set against `ExecutionContextSchema.shape` could not see
it. It was the exact blind spot that gate exists to remove, sitting one `as any`
outside it.

**@objectstack/spec** declares the field:

```ts
authGate: z.object({ code: z.string(), message: z.string() }).optional()
```

Both inner keys are required, matching the sole producer
(`AuthManager.computeAuthGate`, which sets both on every return branch) — `code`
is the stable machine code a client branches on, `message` is what the blocked
user reads, and the transport seam renders both as the `403` body.

**@objectstack/core** picks it up as an ENTRY-decided field — it is resolved from
the request's own session at the transport entry point, never written mid-request
— so `ExecutionContextAssemblyInput` gains a **required** `authGate` input on the
same footing as `accessToken`: every face states its decision instead of omitting
it. A guest principal never carries one (no authenticated session for a policy
gate to attach to). Also exported: `normalizeAuthGate`, which completes a session
user's loose `authGate` into the declared shape at the one producer rather than
tolerating a partial shape downstream — a gate naming a `code` but no `message`
no longer renders a `403` body with `message: undefined`. `AuthGate` is now
derived from the schema instead of being a second hand-written declaration.

**@objectstack/rest** passes the resolved gate as an assembler input and drops the
post-assembly spread; the remaining `as any` covers `__kernel` alone.
**@objectstack/runtime** (the runtime / MCP dispatcher) passes `authGate:
undefined` on the record: it enforces the same gate at its own seam
(`HttpDispatcher.enforceAuthGate` re-reads the session and calls
`evaluateAuthGate`) and never reads `context.authGate`, so carrying it there
would be a second copy no consumer reads.

**No runtime behaviour change on either surface.** The shared assembler omits
`undefined`-valued keys, so the key is present exactly when it was before. The one
new behaviour is the normalization above, on a shape the sole producer never
emits today.
