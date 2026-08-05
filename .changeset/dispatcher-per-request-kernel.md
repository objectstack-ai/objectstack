---
"@objectstack/runtime": minor
---

fix(runtime): the HTTP dispatcher serves each request from its OWN resolved kernel — two tenants can no longer swap data sources under each other (#5155)

A host constructs exactly **one** `HttpDispatcher` (`dispatcher-plugin.ts`
`start()`), and every route it serves shares that instance. The kernel a request
resolves to, however, is per request: on a multi-tenant host the injected
`kernelResolver` (ADR-0006) picks a different one per environment.

That per-request answer was being stored on a dispatcher **instance field**,
`this.kernel`, written once per request by `resolveRequestScope()` and then read
by `resolveService()` / `getService()` / `getObjectQL()` /
`getRequestKernelService()` / `announceKernelEvent()` / `getRegisteredAiRoutes()`
— every one of them behind at least one `await`. Node's single thread is no
protection here: what it protects is code that does **not** hold mutable shared
state across an `await`, and this held it across several.

So two interleaved requests on two environments produced this:

1. request A resolves, `this.kernel` = env-1's kernel;
2. A yields at an `await` (session lookup, driver query);
3. request B resolves, `this.kernel` = env-2's kernel;
4. A resumes and resolves `objectql` / `metadata` / `automation` off **env-2**.

One tenant's request reading another tenant's data source — a correctness and
isolation defect, not a performance one. Single-environment deployments were
never affected (`this.kernel === defaultKernel` always, so the write was
idempotent), which is exactly why no local run or CI job ever showed it. It is
now covered by a deterministic interleaving regression test
(`http-dispatcher.multi-tenant-concurrency.test.ts`), which fails on the old
code with request A being served env-2's data.

**The fix: the resolved kernel travels on the request, and every facility that
reads a kernel takes the request explicitly.** `HttpProtocolContext` gains a
`kernel` field, written by `resolveRequestScope()` alongside the
`environmentId` / `dataDriver` / `executionContext` it already writes there.
There is no longer any `this.kernel` to rewrite. An `AsyncLocalStorage` carrier
was deliberately **not** used: it would have reintroduced implicit mutable
ambient context, which is the shape of this bug in a new costume.

Three host-level readers moved to the host kernel explicitly, where they had
been reading whichever tenant resolved most recently: `/ready` (readiness is a
property of the replica), its driver-health probe, and the memoized
single-environment `default-project` lookup.

**Migration — `DomainHandlerDeps` and `ActionExecutionDeps`.** Every
kernel-reading member now takes the request as its **first** parameter. If you
implement or call either contract (both are exported from
`@objectstack/runtime`; nothing in this monorepo or the sibling distributions
did):

- `deps.resolveService(name, envId)` becomes `deps.resolveService(context, name, envId)`
- `deps.getService(name)` becomes `deps.getService(context, name)`
- `deps.getObjectQL(envId)` becomes `deps.getObjectQL(context, envId)`
- `deps.getRequestKernelService(name)` becomes `deps.getRequestKernelService(context, name)`
- `deps.announceKernelEvent(event, payload)` becomes `deps.announceKernelEvent(context, event, payload)`
- `deps.getRegisteredAiRoutes()` becomes `deps.getRegisteredAiRoutes(context)`

`context` is the `HttpProtocolContext` the domain handler already receives. The
same rule applies to the `action-execution` helpers, which take it right after
`deps`: `callData`, `resolveAutomationService`, `dispatchFlowAction`,
`invokeBusinessAction`, `resolveRouteActionDeclaration`.

`HttpDispatcher.getDiscoveryInfo(prefix)` gains an **optional** second argument,
the request context. Callers that serve `/discovery` straight off the host (the
adapters, the dispatcher plugin) need no change and now describe the host kernel
deterministically instead of whichever tenant asked last.

`resolveProjectKernelObjectQL(context)` keeps its direct-caller kernel swap;
the swap is now written onto that context, so it stays visible to the rest of
that request and to nothing else.
