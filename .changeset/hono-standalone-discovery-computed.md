---
"@objectstack/plugin-hono-server": patch
---

fix(plugin-hono-server): compute the standalone discovery `routes` from real registrations, and cede to the real owner (#4018)

`registerStandardEndpoints` served a **fully static** discovery: a hardcoded
`routes` table listing `auth` / `packages` / `analytics` / `workflow` /
`automation` / `ai` / `notifications` / `i18n` / `storage` / `ui` regardless of
what the host actually mounted. A standalone Hono deployment therefore
advertised ten route families and 404'd on every one no plugin bridged — the
"advertise a route that doesn't exist" class ADR-0076 D12 exists to kill, and
the reason this surface disagreed with the two real discovery builders
(`HttpDispatcher.getDiscoveryInfo`, `metadata-protocol`'s `getDiscovery`), which
both compute per service at runtime.

Two changes, no new discovery implementation to keep in sync:

- **Single owner (D11 / OQ#9).** When `@objectstack/rest` or the runtime
  dispatcher is on the kernel, this surface no longer registers
  `${prefix}/discovery` — that plugin owns it. Both register during plugin
  `start()`, i.e. before this `kernel:ready` hook, and Hono is
  first-registration-wins, so they already shadowed this handler in every
  composed deployment: the cede changes no served payload, it removes a third
  one nobody read. `/.well-known/objectstack` is ceded to the dispatcher only
  (REST never registers it), so a REST-without-dispatcher host keeps the
  redirect.

- **Computed, not hardcoded (D12).** When this surface does own `/discovery`,
  `routes` is derived per request from the app's live route table: a family is
  advertised iff a route is really registered at or under its base path. A
  wildcard mounted *above* the base (global `/*` middleware, `/api/v1/*`) does
  not count as a mount.

**What changes for you.** On a standalone `HonoServerPlugin` host (no REST, no
dispatcher), `GET /api/v1/discovery` now omits every family nothing mounts —
most visibly `routes.metadata`, since `/api/v1/meta` ships with
`@objectstack/rest` / the dispatcher. Clients that read a route out of
discovery and call it stop getting a 404; `@objectstack/client` falls back to
the conventional path for any omitted key, so `client.connect()` is unaffected.
Composed deployments (`os serve`, cloud) are unchanged — the dispatcher's
service-aware discovery was already the one being served.
