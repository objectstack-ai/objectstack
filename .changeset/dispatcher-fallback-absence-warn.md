---
"@objectstack/runtime": patch
---

fix(runtime): an HTTP adapter without `setFallbackHandler` now warns that declarative endpoints are unreachable (#5400)

`setFallbackHandler` is the ONE seam by which a metadata-declared `apis:`
endpoint reaches a handler, and it is optional on `IHttpServer`. On an adapter
that omits it, every declared endpoint is permanently unservable and the caller
gets the transport's bare 404 — indistinguishable from a typo.

Until now the dispatcher announced that at `debug`, which the default
`level: 'info'` does not print at all, so operators had no signal whatsoever.
That level was correct only while a non-empty `apis:` was rejected wholesale at
publish (#4936): no deployment could be missing anything, because none could
declare anything. The #5040 E7 publish flip ended that premise — declarations
publish now and stacks ship them — so the line is raised to `warn` and carries
both halves AGENTS.md's "Absence must be loud" requires:

- **consequence** — every metadata-declared `apis:` endpoint is UNREACHABLE on
  this transport and will answer a bare 404;
- **remedy** — compose an HTTP adapter that implements `setFallbackHandler`
  (e.g. `@objectstack/plugin-hono-server`).

`warn` and deliberately not `error`: this is a functional degradation (a
capability is not mounted, and its next caller finds out), not a durability one
— nothing here claims to have persisted anything. The level is welded by
`packages/runtime/src/dispatcher-plugin.fallback-absence-warn.test.ts`, which
fails both on a slide back to `debug` and on escalation to `error`, and pins
that a conforming adapter stays silent.

Operator-visible only: no API, schema or routing change. A deployment already on
a conforming adapter (the default `@objectstack/plugin-hono-server`) sees
nothing new.
