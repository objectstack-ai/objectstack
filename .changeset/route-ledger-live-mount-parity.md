---
"@objectstack/rest": patch
"@objectstack/runtime": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/spec": patch
"@objectstack/service-settings": patch
---

Mount five ledgered-but-dead routes, and gate the class that hid them (#7526)

Three routes shipped in the ledgers, implemented in the dispatcher, and mounted
by nobody. Two of them answered a plausible `200` rather than a 404, which is
worse: `GET /meta/types` fell into the `/meta/:type` catch-all and returned
`{"type":"types","items":[]}`, shape-identical to `/meta/zzz_not_a_type`, and
`GET /meta/:type/:name/published` fell into the compound-name route and
returned a stub identical before publish **and for a name that does not exist**
— a route that structurally could not 404. `GET /meta/objects/:name/state/:field`
was the honest one: REST's `/meta` registrations topped out at three path
segments and it needs four, so it answered Hono's `notFound`. All three now
mount, `published` 404s for a bogus name, and the compound-name arity the SDK
documents (`getPublished('lead', 'views/all_leads')`) mounts with it.

The routes were the symptom. The route ledgers are a DECLARATION and every
guard built on them (#3563 / #3587 / #3636 / #3642) reads that union as an
OBSERVATION of what is mounted, so the whole audit chain was green on this
class by construction — `/meta/objects/:name/state/:field` counted as mounted
because it was ledgered. This adds the missing observation: a route-ledger ↔
live-mount parity gate that boots a real server, reads the mount table off it,
and asserts both directions — every ledgered route reachably mounted, every
mounted route ledgered. It never consults a second hand-written list of what is
mounted, and it PROBES reachability through the live router rather than
checking presence in a table, because a literal route registered after a
catch-all sibling is mounted and unreachable.

`IHttpServer` grows two optional, feature-detected members for it —
`getMountedRoutes()` (the live mount table, in registration order) and
`resolveMountedRoute(method, path)` (which registration answers a concrete
request, per the router itself) — implemented by the Hono adapter.

The gate found three more instances of the same class on its first run:
`GET /automation/actions`, `/automation/connectors` and `/automation/_status`
were ordered ahead of the `/:name` catch-all inside `dispatch()`, with a
comment saying the order was load-bearing, while the bridge that actually
mounts `/automation` registered `/:name` and never those three. They now mount.
It also found the unledgered live mounts: the four `/api/settings` routes get a
ledger of their own, and `GET /.well-known/objectstack` and the object-less
`POST /actions//:action` get rows in the dispatcher ledger.
