---
"@objectstack/spec": minor
"@objectstack/runtime": minor
"@objectstack/plugin-hono-server": minor
"@objectstack/plugin-auth": patch
"@objectstack/cli": patch
---

feat(spec,runtime,hono): `server.security.rateLimit` — an authored budget that actually returns 429 (#4910, #4937)

Rate limiting in ObjectStack was three shapes with nothing between them. `packages/spec`
declared `RateLimitConfig` in three places and the whole repo had **zero readers** for any
of them, so an author wrote a budget, it parsed, and nothing happened (#4686).
`@objectstack/runtime` shipped a token bucket whose comments claimed, in the present tense,
that the dispatcher called it and short-circuited with 429 — it had **zero call sites**
outside its own unit test, and the `DispatcherPluginConfig.rateLimit` field it told you to
tune did not exist (#4937). Neither half was broken; they were simply never connected, and
both were documented as if they were.

They are connected now, along one narrow path.

## What you write

```ts
export default defineStack({
  manifest: { /* … */ },
  server: {
    security: {
      rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 600 },
    },
    trustProxy: false,
  },
});
```

`server:` is a **new** top-level stack key. Nothing declared it before, so no existing
stack changes behaviour on upgrade — there is no configuration that was inert yesterday
and starts throttling today.

It is deliberately **narrow**: it carries `security.rateLimit` and `trustProxy` and
nothing else, because those are the two keys with a consumer. It is NOT the nine-key
`HttpServerConfigSchema` — the other seven have no reader and no authoring surface, and
mounting them here would have made seven dead keys writable in one move (their
enforce-or-remove fate stays with #4938). It is strict from birth (#4001), so a misspelled
budget is rejected with the correction rather than silently defaulted, and `maxRequests: 0`
is refused at `defineStack` rather than at 3am.

**No `server.port`.** The listening socket belongs to the deployment, not the artifact, and
`objectstack serve -p` already owns it. The precedence rule is recorded in the schema and
the docs in advance, so it cannot be re-litigated per caller: **CLI flag > `server:` >
built-in default.**

## What happens

Every inbound request the server routes — REST, dispatcher, service routes, anything
mounted on that transport — consumes from a token bucket sized `capacity = maxRequests`,
refilling at `maxRequests / (windowMs / 1000)` per second. An empty bucket answers **429**
with a `Retry-After` computed from the bucket itself and the standard error envelope
(`code: "RATE_LIMIT_EXCEEDED"`). `OPTIONS` preflights are never metered.

The bucket is keyed by **resolved principal**, falling back to the caller's **IP** for
anonymous traffic — so one abusive session cannot spend another user's budget, and
credential-stuffing traffic (which has no principal yet) is still metered per source. That
IP comes from `X-Forwarded-For` / `X-Real-IP` **only when `trustProxy: true` is declared**;
otherwise it is the transport's own peer address. Undeclared, those headers are attacker
input: honouring them by default would hand anyone an unlimited supply of fresh buckets and
let them drain a chosen victim's.

Counters live in the kernel `cache` service when one is registered, so a multi-node
deployment enforces one budget instead of one per node (ADR-0069 D2), resolved lazily at
consume time so a cache plugin that registers later is still picked up (#4772). With no
cache service at all it falls back to a per-process store and says so once, naming the
consequence: the effective limit becomes the declared budget multiplied by the number of
nodes, and nothing about the deployment looks wrong.

## Also in this change

- **`IHttpServer.use()` is a real middleware seam.** The Hono adapter's implementation
  passed `{}` for both `req` and `res` and called `next()` unconditionally, so a registered
  middleware could not read the request, write a response, or decline to continue — a
  declared seam with no execution behind it, unnoticed because nothing called it. It now
  delivers method/path/query/headers plus the transport peer address
  (`IHttpRequest.remoteAddress`, new), and honours a short-circuit. Middleware must be
  registered before the routes it guards; the kernel's two-phase boot makes that automatic
  (`init()` before every `start()`).
- **`packages/runtime/src/security/rate-limit.ts` no longer describes an execution chain it
  does not have** (#4937). The token-bucket arithmetic is extracted so the synchronous
  in-process limiter and the new shared-store one cannot drift, and `DEFAULT_RATE_LIMITS` is
  now labelled as the reference material it always was rather than as live defaults.

## Explicitly NOT wired

`ApiEndpointSchema.rateLimit` and `ApiEndpointRegistrationSchema.rateLimit` remain
**known-unwired**. Declaring them still changes nothing. They are not retired here either:
the fate of the whole declarative `apis:` surface is undecided (#4936), and retiring one
key of a surface that may yet be implemented would only have to be undone. Tracked, not
silent.
