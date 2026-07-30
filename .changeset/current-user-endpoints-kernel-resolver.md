---
"@objectstack/plugin-hono-server": minor
---

fix(plugin-hono-server): the current-user endpoints answer from the kernel that OWNS the request (cloud#927)

`/api/v1/auth/me/permissions`, `/auth/me/localization` and `/me/apps` resolved
their answer from the service locator captured at REGISTRATION time. On a
single-environment host that is the only kernel, so it is right. On a
**multi-tenant** host it is the routing shell — and identity is not there.
cloud's `ArtifactKernelFactory` mounts `AuthPlugin` per environment, and its host
kernel deliberately has none ("AuthPlugin is intentionally NOT injected on the
host"), so `getService('auth')` threw, the session resolver fell to its catch, and
every authenticated tenant caller got `{authenticated:false}`.

That is worse than an error: objectui's `MePermissionsProvider` reads
`authenticated:false` as ANONYMOUS and keeps its permissive default
(`return data.authenticated !== true`), because a guest surface has no resolvable
permissions by design. So the console's FLS / `apiOperations` hints were
systematically wrong — not a bypass (the server still enforces per request), but
exactly the client/server divergence `foldWildcardSuperUser` and
`clampManagedObjectWrites` exist to close, one layer up.

These endpoints now consult the host's ADR-0006 **`kernel-resolver`** seam per
request — the same seam the runtime dispatcher has used since Phase 5, so
multi-tenant routing has one strategy rather than two:

- **No `kernel-resolver` registered** → unchanged. Single-environment hosts,
  `os serve`, and the QA conformance host see no difference.
- **A kernel** → that kernel's `auth` / `objectql` / `metadata` /
  `security.permissions` answer.
- **`undefined`** → the registration-time locator, which is the seam's contract
  for an unscoped / control-plane request.
- **A throw** → no answer at all: the thrown status when it carries one (cloud's
  `KernelWarmingError` is 503 + `Retry-After`), else 503
  `environment_unavailable`. Falling back to the default kernel would hand back a
  confidently-wrong `{authenticated:false}` that the client fails OPEN on.

The seam is read **lazily, per request**, never captured at registration — a host
may register these routes before `kernel.bootstrap()` (to outrank an
`/api/v1/auth/*` wildcard), which is before the plugin that registers the
resolver has run its `init()`.

**FROM → TO for host adapters.** `CurrentUserEndpointsContext` gains an optional
`getKernel(): unknown`, the `defaultKernel` argument the seam takes. A
`PluginContext` already satisfies it, so hosts that mount `HonoServerPlugin` need
no change. A host passing a hand-rolled locator to
`registerCurrentUserEndpoints` should add it:

```diff
 registerCurrentUserEndpoints({
   rawApp: httpServer.getRawApp(),
-  ctx: { getService: (n) => kernel.getService(n) },
+  ctx: { getService: (n) => kernel.getService(n), getKernel: () => kernel },
 });
```

Without it a multi-tenant host cannot be asked which kernel owns the request and
keeps the old provenance — a silent downgrade, so it is worth adding even where
the host is single-environment today.
