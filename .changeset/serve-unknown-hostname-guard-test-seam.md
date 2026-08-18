---
"@objectstack/cli": patch
---

test(cli): `os serve`'s unknown-hostname guard gets a test seam — the middleware, refusal included, is now reachable without booting a server (#9442)

The `OS_ROOT_DOMAIN` guard was a plugin object literal built inside
`Serve.run()`, closing over its locals and installing itself on a `http.server`
service resolved from the plugin context. Nothing about it was exported or
constructible, so every branch — the health/readiness bypass whose own comment
says a 404 there "would kill the container", the reserved-subdomain and
`/_console` redirect branches, the `/_admin` and `/.well-known` pass-throughs,
the lazy env-registry read whose every failure mode falls through — had zero
regression coverage.

It is now `createUnknownHostnameGuardPlugin()`, exported from `serve.ts` the way
its sibling helpers are, with `run()` calling it. Behaviour is unchanged: same
branches in the same order, same bodies, and `OS_CLOUD_URL` is still read per
request rather than captured at install time. What is new is a suite that mounts
the real middleware on a real Hono app and pins BOTH directions — every bypass
as an explicit pass-through, and the refusal by `error.code` **and** HTTP status
together.
