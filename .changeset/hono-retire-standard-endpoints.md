---
"@objectstack/plugin-hono-server": major
---

feat(plugin-hono-server)!: delete the CRUD/discovery convenience surface and the `registerStandardEndpoints` flag — the plugin is a transport adapter (#4073)

Completes the retirement. `HonoServerPlugin` now owns the socket, the middleware
and the three current-user endpoints, and nothing else. The data and discovery
APIs have one owner each: `@objectstack/rest` and the runtime dispatcher
(ADR-0076 D11).

**Removed**

- `POST/GET /api/v1/data/:object` and `GET /api/v1/data/:object/:id` — the raw
  C+R surface that delegated straight to ObjectQL.
- `GET /api/v1/discovery` and `GET /.well-known/objectstack` — this plugin's
  third discovery payload, which predated `DiscoverySchema` and could not
  satisfy it (no `services`, the ADR-0076 D12 source of truth).
- The `registerStandardEndpoints` option. It is gone, not defaulted off: passing
  it is now a type error, and passing it via `as never` mounts nothing.

**Unaffected**

- `/auth/me/permissions`, `/auth/me/localization` and `/me/apps` — this plugin
  is the platform's only supply and they register unconditionally (#4144).
- Every composed host: `os serve`, `objectstack dev`, cloud's objectos and every
  documented composition mount REST and/or the dispatcher, which already served
  these routes and answered byte-identically with the flag on or off (#4260).

**Migration** — only a host that mounts `HonoServerPlugin` with neither owner is
affected. It now has no data or discovery API, and the boot warns once naming
both remedies. Mount `createRestApiPlugin` from `@objectstack/rest` for full
CRUD behind the gate stack, or `createDispatcherPlugin` from
`@objectstack/runtime`. There is no flag to opt back in.

**Why** — the surface was duplicate and lesser supply (C+R only, a subset of the
gates, a non-conforming discovery payload), and it charged rent: #2567, #3298
and #4018 each had to re-implement a platform invariant on it after the fact,
because a second implementation of a route is a second place every future
invariant must be remembered.
