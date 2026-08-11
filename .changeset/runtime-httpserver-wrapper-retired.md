---
"@objectstack/runtime": major
---

refactor(runtime)!: retire the exported `HttpServer` delegating wrapper — it declared `implements IHttpServer` and forwarded none of the contract's optional members (#5122)

**BREAKING.** `@objectstack/runtime` no longer exports `HttpServer`, and
`packages/runtime/src/http-server.ts` is deleted.

## What it was, and why it could not stay

The class took an `IHttpServer` in its constructor and forwarded that server's
**required** members — `get` / `post` / `put` / `delete` / `patch` / `use` /
`listen` / `close` — while declaring `implements IHttpServer`. It forwarded not
one of the contract's **optional** members:

| Optional member | What wrapping it cost |
| --- | --- |
| `getPort?()` | the real bound port after `listen(0)`; harnesses and `@objectstack/http-conformance` address the server through it |
| `getRawApp?()` | the framework-native escape hatch four consumers feature-detect (cloud-connection ×2, metadata's HMR routes, cloud's serverless node server) |
| `setFallbackHandler?()` | since #5111, the **only** entry path there is for declarative `apis:` endpoints |

`packages/spec/src/contracts/http-server.ts` tells consumers to feature-detect
those members with `typeof server.X === 'function'` and to degrade when they are
absent. Wrapping a capable adapter therefore made every probe answer **false**
and the capability disappear — with the adapter underneath providing it the
whole time. Write this row down before reaching for a wrapper of the same shape:
**a host that wrapped `HonoHttpServer` and registered the wrapper as
`http.server` would answer 404 to every endpoint its metadata declared**,
because the seam those endpoints mount through was never forwarded. The dispatcher's
own #5409 declaration — the seam's absence announced at `warn`, welded by
`packages/runtime/src/dispatcher-plugin.fallback-absence-warn.test.ts` — remains
the runtime-side backstop and still fires here, but it can only name the missing
seam; it cannot name the wrapper that swallowed it.

## Migration

**Register an `IHttpServer` adapter INSTANCE, don't wrap one.** Every real host
in this repository already does; `new HttpServer(` had zero occurrences in the
repository, examples included, which is why this retirement carries no rollback
risk and why it is cheaper to take now than later.

| Wrote | Write instead |
| --- | --- |
| `new HttpServer(new HonoHttpServer(port))` registered as `http.server` | register the `HonoHttpServer` (or your own adapter) directly — `HonoServerPlugin` already does |
| a wrapper of your own to add cross-cutting behaviour | forward **every** member you did not deliberately drop, optional ones included, and re-probe with `typeof` after wrapping; a delegator that narrows the contract silently removes capabilities |
| `import { HttpServer } from '@objectstack/runtime'` | remove it — `tsc` reports this one, the symbol is simply gone |

Unlike a method quietly dropped from a class, this break is visible to the
compiler: the export does not exist, so nothing type-checks past it. Its absence
from the barrel is additionally pinned at runtime by
`packages/runtime/src/http-server-retirement.test.ts`.

## Why retirement rather than conditional forwarding

Growing a forwarding surface nobody composes would have to be maintained forever
and re-audited every time `IHttpServer` gains an optional member — it gained one
as recently as #5080. The 2026-08-06 maintainer ruling took the #4939
(`ApiRegistry`) precedent instead — retiring a part that was never assembled
beats repairing it — under ADR-0049's remove side.

<!-- adr-0087: registered runtime-httpserver-wrapper-retired -->
