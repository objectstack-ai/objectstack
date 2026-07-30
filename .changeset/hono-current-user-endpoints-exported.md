---
"@objectstack/plugin-hono-server": minor
---

feat(plugin-hono-server): export `registerCurrentUserEndpoints` so a host without the plugin can still supply them (cloud#924)

`GET /api/v1/auth/me/permissions`, `/api/v1/auth/me/localization` and
`/api/v1/me/apps` are the platform's **sole** supply — neither
`@objectstack/rest` nor `@objectstack/runtime` registers any `/me/*` route, the
objectui console reads the first for its whole permission layer and the second
for regional defaults, and `core`'s auth gate allow-lists the last two as
endpoints a gated user MUST still reach. #4073/#4079 freed them from the
`registerStandardEndpoints` flag, but left the supply welded to
`HonoServerPlugin`: a host that stands up a bare `HonoHttpServer` and registers
it as `http.server` itself — rather than mounting the plugin — got no provider at
all, and the console's FLS / `apiOperations` had no server-side answer on that
startup path.

Registration needs a Hono app and a service locator, not ownership of the
listening socket, so it is now a standalone module (`./current-user-endpoints`)
that both shapes call:

```ts
import { registerCurrentUserEndpoints } from '@objectstack/plugin-hono-server';

const httpServer = new HonoHttpServer();
kernel.registerService('http.server', httpServer);
registerCurrentUserEndpoints({
  rawApp: httpServer.getRawApp(),
  // any { getService, logger } — a PluginContext satisfies it structurally
  ctx: { getService: (n) => { try { return kernel.getService(n); } catch { return undefined; } } },
});
```

It is **idempotent**: it returns `false` and registers nothing when all three
paths are already served, so a host may both call it eagerly on the raw app AND
mount the plugin — the plugin's `kernel:ready` registration then no-ops instead
of shadowing the host's routes with dead duplicates. Registering early matters,
because Hono's only route precedence is first-registration-wins and plugin-auth
mounts a `/api/v1/auth/*` wildcard that `/auth/me/*` must outrank.

**No behaviour change for existing hosts.** `os serve` and every host that mounts
`HonoServerPlugin` register the same three routes, in the same `kernel:ready`
position, with the same response shapes — the plugin now delegates to the shared
registrar instead of owning a private method.

**Moved exports (same package, same names, no rename).** `foldWildcardSuperUser`,
`clampManagedObjectWrites`, `seedSuperUserRestrictedObjects`,
`annotateEffectiveApiOperations`, `ManagedSchemaLike` and `ApiExposureSchemaLike`
now live in `./current-user-endpoints` alongside the endpoint they shape. Importing
them from the package root (`@objectstack/plugin-hono-server`) is unchanged; only a
deep import of `.../dist/hono-plugin` would need updating, and the package exposes
no such subpath.
