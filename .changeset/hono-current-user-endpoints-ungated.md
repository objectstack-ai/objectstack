---
"@objectstack/plugin-hono-server": minor
---

fix(plugin-hono-server): stop gating the current-user endpoints behind `registerStandardEndpoints` (#4073)

`registerStandardEndpoints` gated two unrelated things behind one flag:

- **Duplicate supply** — raw `POST/GET /api/v1/data/:object` (create + read
  only), which `@objectstack/rest` also serves and, registering first, is what
  actually answers; plus `GET /api/v1/discovery` and
  `/.well-known/objectstack`, which the dispatcher and REST own and which this
  surface already cedes to them (#4018).
- **Sole supply** — `GET /api/v1/auth/me/permissions`,
  `/api/v1/auth/me/localization` and `/api/v1/me/apps`. Nothing else in the
  platform mounts these: neither `@objectstack/rest` nor `@objectstack/runtime`
  registers any `/me/*` route, the console's entire permission layer reads
  `/auth/me/permissions`, the console reads `/auth/me/localization` for regional
  defaults, and `core`'s auth gate allow-lists `/me/apps` + `/me/localization`
  as endpoints a gated user MUST still reach to bootstrap the remediation UI.

`os serve` gets all of it only because the flag defaults to `true` — the CLI
constructs `new HonoServerPlugin({ port })`. So `registerStandardEndpoints:
false`, whose documented job is the optional CRUD/discovery convenience surface,
silently took the console's permissions and localization down with it.

The three current-user endpoints now register **unconditionally**, and the flag
covers the duplicate half only — what its name and docs always claimed.

**FROM → TO.** If you set `registerStandardEndpoints: false` and worked around
the missing endpoints (proxying `/auth/me/permissions` yourself, or pinning the
flag to `true` purely to keep them), you can drop that workaround: the endpoints
are now present either way. No route is removed and no response shape changes,
so a host that left the flag at its default sees no difference. If you relied on
`false` meaning "this plugin mounts no `/api/v1` routes at all", that is no
longer true — it never was for `os serve`, which is the only host that shipped
the flag's default.

Also removes three unreferenced `*_ENDPOINT_PRIORITY` constants;
`DISCOVERY_ENDPOINT_PRIORITY = 900` in particular implied a route-priority
mechanism that does not exist (precedence here is Hono's
first-registration-wins).
