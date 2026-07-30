---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): the auth catch-all yields paths better-auth does not own (#4088)

`registerAuthRoutes` mounts `rawApp.all('${basePath}/*')` over the whole auth
namespace (`/api/v1/auth` by default), and that handler was **terminal**: it
returned better-auth's response unconditionally, including the 404 better-auth
produces for a path it does not implement. Any other plugin's route under that
prefix was therefore reachable only if it happened to register **first** — Hono
runs handlers matching a path in registration order and the first to return a
Response wins.

That put a load-bearing surface at the mercy of `kernel.use()` order.
`@objectstack/plugin-hono-server` mounts `/auth/me/permissions` and
`/auth/me/localization` from its own `kernel:ready` hook; objectui's entire
permission layer reads the former and `core`'s auth gate allow-lists the latter
as an endpoint a gated user must still reach. Register `AuthPlugin` before
`HonoServerPlugin` and all of it silently 404s.

A 404 from better-auth now means "this path is not mine" and the catch-all yields
to whatever else matched, in either registration order. Deliberately narrow:

- **Only 404 falls through.** 401/403 are real better-auth answers, not
  disclaimers of ownership.
- **Precedence still favours the namespace owner.** better-auth wins every path
  it implements; only its leftovers are up for grabs.
- **The unclaimed-path wire shape is unchanged.** When nothing downstream
  answers, better-auth's own 404 is returned verbatim rather than Hono's
  `404 Not Found`.

No configuration changes and no new routes. The only behavioural difference for
an existing deployment is that a route another plugin mounts under
`/api/v1/auth/*` now answers regardless of plugin order — previously it answered
only in the lucky order.
