---
"@objectstack/plugin-hono-server": minor
---

feat(plugin-hono-server): `registerStandardEndpoints` now defaults to `false` — the deprecated CRUD/discovery convenience surface is opt-in (#4073)

The flag mounts raw C+R `/api/v1/data/:object` and `/api/v1/discovery` /
`/.well-known/objectstack`. Every path it mounts is duplicate — and lesser —
supply: C+R only, a subset of the gates, a pre-`DiscoverySchema` discovery
payload. `@objectstack/rest` serves full `/data` CRUD behind the whole gate
stack, REST/the dispatcher own discovery (#4018 cede), and #4260 pinned that a
composed host answers **byte-identically** with the flag on or off. The surface
has also been a standing tax: #2567, #3298 and #4018 each had to re-implement a
platform invariant here after the fact.

**FROM → TO**

- **Composed hosts (REST and/or the dispatcher mounted)** — `os serve`,
  `objectstack dev`, cloud's objectos, every documented path: **no change**.
  Those plugins already answer every route this surface covered, and answered
  them first.
- **Bare hosts (HonoServerPlugin only)**: `/api/v1/data/:object`,
  `/api/v1/discovery` and `/.well-known/objectstack` are **no longer mounted by
  default**. The boot now logs a warn naming the flag and the remedy instead of
  leaving a silent 404. Migrate by mounting `createRestApiPlugin` from
  `@objectstack/rest` — it needs the same `objectql` service this surface
  already required, and returns full CRUD plus the gate stack — or pass
  `registerStandardEndpoints: true` to keep the legacy surface during the
  deprecation window.
- The current-user endpoints (`/auth/me/permissions`, `/auth/me/localization`,
  `/me/apps`) are **unaffected** — they never sat behind this flag (#4144) and
  register unconditionally.

The flag is now marked `@deprecated`. Next step per #4073: one release of
observation, then `registerDiscoveryAndCrudEndpoints` (and the flag) are deleted
and this plugin becomes a pure transport adapter (ADR-0076 D11).
