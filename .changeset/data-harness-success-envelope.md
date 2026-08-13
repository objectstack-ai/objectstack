---
"@objectstack/runtime": patch
---

test(runtime): drive `/data`'s success exit through the real ADR-0112 envelope (#7362)

Coverage only, no behaviour change. `data-path-object.test.ts`'s `DomainHandlerDeps`
stand-in answered its success exit with `success: (data) => ({ status: 200, body: data
})` — the domain's return value handed back AS the whole body, with no `success: true`
flag, no `data` nesting, and no `meta` key, while production's
`HttpDispatcher.success()` wraps all three. So a success-envelope regression could not
go red in that harness.

This is the mirror half of #6719, which converged the same harness's three error exits
(`error` / `routeNotFound` / `errorFromThrown`) onto the real `HttpDispatcher`. The
success exit is now taken off the same real dispatcher (`success: domainDeps.success`),
and two new cases drive a real `/data` success path through it and assert the envelope
off the actual response body (`success: true`, the payload nested under `data`, the
`meta` key) — not a hand-built object. Reverse-verified: restoring the old stand-in
makes both new cases fail with `BaseResponseSchema.safeParse(body).success === false`,
i.e. the envelope is absent, not a compile error.
