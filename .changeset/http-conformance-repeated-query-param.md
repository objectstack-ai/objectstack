---
"@objectstack/http-conformance": patch
---

test(http-conformance): a repeated query parameter is now a pinned cross-adapter fact, instead of an unrecorded disagreement

The two `IHttpServer` implementations hand a handler two different `req.query`
shapes for one and the same request, and until now nothing in the repo said so.
Re-measured for this change on hono@4.12.34, over a real socket, through the
same public entry points production uses:

```
GET /probe?version=1.0.0&version=2.0.0&single=9

[NodeHttpServer]  { version: ['1.0.0', '2.0.0'], single: '9' }   // array
[HonoHttpServer]  { version: '1.0.0',            single: '9' }   // first value
```

`NodeHttpServer` reads `url.searchParams.getAll(key)` and keeps the array when
`length > 1`; `HonoHttpServer` reads `c.req.query()`, which yields the first
value per key.

**Neither adapter is wrong.** `IHttpRequest.query` is declared
`Record<string, string | string[]>` and both shapes satisfy it, so this is a
divergence the contract currently permits — not a bug on either side. What was
missing was any gate recording it: the platform's answer to a repeated query
parameter depends on which server booted, and this package exists precisely to
assert that everything registered through `IHttpServer` behaves the same on a
non-Hono server.

The node half was already pinned, but only adapter-locally (`adapter.test.ts`,
`?a=1&b=x&b=y`). Neither `describe.each(ADAPTERS)` suite repeated a parameter at
all, so the one place the adapters visibly disagree was the one place the
cross-adapter suite was not looking. Consumer-side tests do not cover it either:
`packages/rest`'s `package-routes-query-multiplicity.test.ts` (#6307)
hand-constructs `query: { version: [...] }` and drives the handler directly, so
it asserts a shape no adapter is obliged to produce.

`query-multiplicity.conformance.test.ts` therefore **records the divergence as
it is** rather than asserting a unified answer — there is no unified answer yet,
and inventing one in a test file would settle #6878's open contract question
through the back door. Each adapter row carries its measured shape, one describe
states the disagreement out loud, and a single-valued control key separates
"arrays repeats" from "arrays everything".

This is route 1 of #6878 only. Both adapters' behaviour is unchanged and
`packages/spec/src/contracts/http-server.ts` is untouched; the choice between
"always array" and "always single" stays open on that card. When it is decided,
this file goes red on purpose — that red is the reminder to collapse the
per-adapter rows into one shared expectation.
