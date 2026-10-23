# Production HTTP Hardening

This guide covers the HTTP-layer defences ObjectStack ships out of the
box, what's opt-in vs on by default, and what you must wire at the
adapter layer for a production deployment.

> **See also:** [Observability](./OBSERVABILITY.md) — metrics, request
> ids, and error reporting for the same dispatcher plugin.

## TL;DR

| Concern                                | Default               | Where                          |
| -------------------------------------- | --------------------- | ------------------------------ |
| Security response headers (CSP/XCTO/…) | **On**                | `@objectstack/runtime`         |
| HSTS                                   | Off (opt-in)          | `securityHeaders.hsts: true`   |
| Inbound rate limit (token bucket)      | Off (opt-in)          | `server.security.rateLimit`    |
| CSRF                                   | Adapter-layer concern | `hono/secure-headers` / `hono/csrf` |
| Auth (better-auth)                     | On                    | `@objectstack/plugin-auth`     |
| Auth hardening (ADR-0069)              | Off (opt-in)          | Setup → Authentication         |
| Project membership (RBAC)              | On when scoped        | dispatcher plugin              |
| Field- and row-level perms             | On                    | SecurityPlugin                 |
| Request id / metrics / 5xx reporting   | Noop default          | see [Observability](./OBSERVABILITY.md) |

## Security response headers

Every response routed through the dispatcher plugin gets a conservative
header set merged in:

```
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
X-Content-Type-Options:  nosniff
X-Frame-Options:         DENY
Referrer-Policy:         no-referrer
Permissions-Policy:      geolocation=(), camera=(), microphone=(), payment=()
Cross-Origin-Resource-Policy: same-origin
```

These defaults assume the dispatcher is serving **APIs**, not HTML. If
the same host also serves a SPA, configure a less restrictive CSP for
the HTML route (or — better — serve the SPA from a different origin and
let the API stay locked down).

Customize via `createDispatcherPlugin({ securityHeaders: … })`:

```ts
kernel.use(createDispatcherPlugin({
    prefix: '/api/v1',
    securityHeaders: {
        hsts: true,                              // turn HSTS on once TLS is confirmed
        contentSecurityPolicy: false,            // disable, e.g. if your SPA host owns it
        extra: { 'X-DNS-Prefetch-Control': 'off' },
    },
}));
```

Pass `securityHeaders: false` to disable entirely (only sensible when
an upstream reverse proxy is already setting them — verify with
`curl -I`).

## Rate limiting

The runtime ships an inbound rate limiter. It is built in and **off by
default**: with no budget declared nothing is registered, so an unmetered
deployment pays no per-request cost. Declare a budget on the stack's
`server:` block and `objectstack serve` arms it:

```ts
import { defineStack } from '@objectstack/spec';

export default defineStack({
    // …
    server: {
        security: {
            rateLimit: {
                enabled: true,
                windowMs: 60_000,      // the window, in MILLISECONDS
                maxRequests: 300,      // requests per caller per window
            },
        },
        trustProxy: true,              // ONLY behind a proxy you control (see below)
    },
});
```

What the runtime does with it:

- The limiter is global middleware on the `http.server` service, so every
  request the server routes is metered — REST data, auth, metadata and every
  other mount. CORS preflights (`OPTIONS`) are never metered.
- It is a token bucket: capacity `maxRequests`, refilled at
  `maxRequests / (windowMs / 1000)` tokens per second. A caller can burst one
  full window's worth and sustains exactly the declared rate. `enabled: true`
  with no numbers meters 100 requests per 60 000 ms.
- A caller over budget gets `429` with a `Retry-After` header (seconds) and
  the standard error envelope, `error.code: "RATE_LIMIT_EXCEEDED"`. No
  `X-RateLimit-*` headers are sent.
- `maxRequests` or `windowMs` of `0` or less is refused at `defineStack`, with
  the fix in the message; to turn the limiter off, set `enabled: false`. An
  unknown key in the budget is refused too — the key and the counter store
  are not authorable (see below).
- It is **one bucket per caller** across all routes, not one per traffic
  class (see [Per-class budgets](#per-class-budgets)).
- Boot logs `Inbound rate limit armed` with the budget and the `trustProxy`
  value — the line to look for after a deploy.

Composing the kernel yourself instead of `objectstack serve`, pass the same
two values to the dispatcher plugin:
`createDispatcherPlugin({ rateLimit: { budget: { enabled: true, windowMs: 60_000, maxRequests: 300 }, trustProxy: false } })`.
It needs an `http.server` service; without one it warns at start that
nothing can be metered.

### Who a caller is: the key, and `server.trustProxy`

The bucket is keyed by **who**, falling back to **where** only when there is
no who:

| Request | Bucket key |
| --- | --- |
| Carries a valid session | `principal:<user id>` — one abusive session cannot spend another user's budget, and users behind one NAT do not throttle each other |
| Anonymous, `server.trustProxy` unset (the default) | `ip:<transport peer address>` — the socket's own address, which a client cannot forge |
| Anonymous, `server.trustProxy: true` | `ip:<address>` — the **leftmost** `X-Forwarded-For` entry, else `X-Real-IP`, else the peer address when neither header is present |
| Anonymous, no address can be established | one shared `ip:unknown` bucket, with a warning logged once — it over-throttles rather than failing open |

Set `server.trustProxy: true` **only** when a reverse proxy you control
**overwrites** `X-Forwarded-For` on every inbound request (nginx:
`proxy_set_header X-Forwarded-For $remote_addr;`). A proxy that *appends*
(`$proxy_add_x_forwarded_for`) leaves the leftmost entry — the one read —
whatever the client sent. Getting it wrong costs in either direction:

- **Behind a proxy, left unset:** every anonymous caller has the proxy's
  address, so all anonymous traffic shares one bucket.
- **Set without such a proxy:** `X-Forwarded-For` is caller input. A client
  mints a fresh bucket per request (limit bypassed) or claims a victim's
  address and spends their budget (limit weaponised).

The same value drives every consumer of the client address: the
authentication plugin's IP allow-list (`allowed_ip_ranges`) and
`last_login_ip` audit, and the budget of every declared endpoint
(`apis[].rateLimit`). Composing the kernel yourself, hand it to `AuthPlugin`
too (`trustProxy` option); `objectstack serve` does that for you.

### Multi-node: the counters need a shared store

The buckets live in the kernel `cache` service, resolved when the first
request is metered, so a cache plugin that registers late is still found.
Under `objectstack serve` the `cache` service is always on and is served by
`@objectstack/service-cache`, whose only working adapter is **in-memory** —
per process. On one node that is exact. On N nodes each counts on its own,
so the effective limit is the budget **multiplied by N**, and nothing about
the deployment looks wrong.

For one limit across nodes, register a `cache` service backed by a store
every node shares (Redis, Memcached, …) that implements the
[`ICacheService` contract](../content/docs/kernel/contracts/cache-service.mdx)
— see [Registering Services](../content/docs/kernel/services.mdx#registering-services).
`CacheServicePlugin({ adapter: 'redis' })` is not that: its Redis adapter is a
skeleton and the plugin refuses to start with it. Boot logs which store the
limiter bound to: `inbound rate-limit buckets bound to the kernel cache
service — enforced against ONE store across nodes iff the cache is shared`,
or, with no `cache` service at all, a warning that it fell back to a
per-process store. Counting is read-modify-write, so two nodes can both admit
the last request at a window boundary — a slight over-admit, never a
per-node limit.

### Per-class budgets

The built-in limiter is one budget for all traffic. Two tighter budgets
already exist without writing middleware:

- **Sign-in and other auth endpoints:** `rate_limit_max` /
  `rate_limit_window_seconds` in **Setup → Authentication** (see
  [Authentication hardening](#authentication-hardening-adr-0069)), counted in
  the same `cache` service.
- **One declared endpoint:** its own `rateLimit` in `apis[]`, metered in a
  separate namespace, independently of the server budget.

Composing the Hono adapter yourself and wanting per-class buckets on top
(say 10/min for `/auth/*`, 60/min for writes, 600/min for reads), key them
with the runtime's own resolver so the trust rule is the same one the
built-in limiter applies. `RateLimiter` counts in process, so this layer is
per node:

```ts
import { Hono } from 'hono';
import { objectStackMiddleware } from '@objectstack/hono';
import { RateLimiter, DEFAULT_RATE_LIMITS, resolveRateLimitKey } from '@objectstack/runtime';

const TRUST_PROXY = false;   // the same value as `server.trustProxy`

const buckets = {
    auth:  new RateLimiter(DEFAULT_RATE_LIMITS.auth),    //  10 req / min
    write: new RateLimiter(DEFAULT_RATE_LIMITS.write),   //  60 req / min
    read:  new RateLimiter(DEFAULT_RATE_LIMITS.read),    // 600 req / min
};

const app = new Hono();
app.use('/api/v1/*', async (c, next) => {
    const { key } = resolveRateLimitKey({
        headers: c.req.header(),
        // @hono/node-server exposes the Node request as `c.env.incoming`.
        remoteAddress: c.env?.incoming?.socket?.remoteAddress,
        trustProxy: TRUST_PROXY,
    });
    const bucket = c.req.path.startsWith('/api/v1/auth/') ? 'auth'
                 : ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) ? 'write'
                 : 'read';
    const decision = buckets[bucket].consume(`${key}:${bucket}`);
    if (!decision.allowed) {
        c.header('Retry-After', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
        return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
});
app.use('/api/v1/*', objectStackMiddleware(kernel));   // dispatcher last
```

This recipe has no session in hand, so it keys anonymous-style (by address)
unless you pass `principalId` yourself. `DEFAULT_RATE_LIMITS` is reference
material: nothing in the runtime reads it.

## CSRF

ObjectStack APIs are JSON-only and authenticate via `Authorization:
Bearer …`. With bearer tokens stored in `localStorage` / memory there
is no CSRF surface — browsers don't auto-attach the header.

CSRF protection becomes required when you switch to **cookie-based
session auth**. In that case wire a CSRF middleware (e.g. `hono/csrf`)
and exempt only the auth callback routes.

## Authentication hardening (ADR-0069)

Beyond transport-layer defences, `@objectstack/plugin-auth` ships an enterprise
authentication-hardening layer. Each control is **opt-in** from **Setup →
Authentication** and backed by real runtime enforcement (ADR-0049). For a new
production deployment, enable at least:

| Group       | Recommended settings                                                                 |
| ----------- | ------------------------------------------------------------------------------------ |
| Password    | `password_reject_breached: true`, `password_require_complexity: true`, `password_history_count: 3–5`, `password_expiry_days: 90` |
| Anti-abuse  | `lockout_threshold: 5`, `lockout_duration_minutes: 15`, `rate_limit_max` / `rate_limit_window_seconds` |
| MFA         | `mfa_required: true` (or per-org `require_mfa`), `mfa_grace_period_days: 7`            |
| Sessions    | `session_idle_timeout_minutes: 30–60`, `session_absolute_max_hours: 8–12`, `max_concurrent_sessions_per_user` |
| Network     | `allowed_ip_ranges` (IPv4 CIDR) for tenant- or office-scoped access                   |

Password expiry and enforced MFA share a *session-validation gate*: a
non-compliant session can authenticate but is blocked from data access (auth +
health + a remediation allowlist still pass) until the user rotates the password
or enrols MFA. See the
[Authentication guide](../content/docs/permissions/authentication.mdx#enterprise-authentication-hardening-adr-0069)
for the full per-setting reference.

## JWT / session lifecycle

ObjectStack uses [better-auth](https://www.better-auth.com/) via
`@objectstack/plugin-auth`. Sessions:

| Aspect            | Default                                   | Override                                  |
| ----------------- | ----------------------------------------- | ----------------------------------------- |
| Session TTL       | 7 days                                    | `session.expiresIn` (seconds)             |
| Access token TTL  | inherited from session                    | configure in better-auth                  |
| Refresh           | better-auth `/auth/get-session` rolls TTL | `session.updateAge` (seconds)             |
| Revocation        | DELETE on `session` row                   | `revokeSessionsOnPasswordReset: true`     |
| Idle / absolute / concurrent caps | Off (opt-in)              | `session_idle_timeout_minutes` / `session_absolute_max_hours` / `max_concurrent_sessions_per_user` (Setup → Authentication) |
| Email verify TTL  | 1 hour                                    | `emailVerification.expiresIn`             |

### Verification checklist (run before going live)

```bash
# 1. Confirm token expiry is enforced server-side
curl -H "Authorization: Bearer <expired-token>" $API/data/account
# → 401 Unauthorized

# 2. Confirm logout revokes the session
curl -X POST -H "Authorization: Bearer $TOK" $API/auth/sign-out
curl -H "Authorization: Bearer $TOK" $API/data/account
# → 401 Unauthorized

# 3. Confirm password reset revokes all other sessions for that user
#    (requires revokeSessionsOnPasswordReset: true)
```

## CORS

Which cross-origin callers are admitted is an app-level decision — it
depends on which origins host your front-end — so the server that
`os serve` / `os start` mount (`HonoServerPlugin`) admits only the
origins you name:

| Configuration | What is admitted |
| --- | --- |
| No origin list (neither `OS_CORS_ORIGIN` nor the plugin's `cors.origins`) | **No cross-origin caller.** On a development boot (`NODE_ENV=development`, which `os dev` and `os serve --dev` set), loopback origins (`localhost`, `127.0.0.1`, `[::1]`, any port) are admitted too. |
| A list (`OS_CORS_ORIGIN=https://app.example.com`, comma-separated; exact origins or patterns such as `https://*.example.com`) | Those origins, with credentials unless `OS_CORS_CREDENTIALS=false`. On a development boot, loopback origins are admitted beside the list too; on any other boot, only what the list names. |
| `*`, or a pattern whose host part is the bare `*` (`https://*`, `*://*`), while credentials are on | **Refused at boot** — the boot fails with a message naming the entry and the two remedies. |

Same-origin requests need no CORS answer, so the Console under
`/_console` and any page the server itself serves work with no list at
all. A front-end served from **another origin** needs one CORS
variable:

```bash
OS_CORS_ORIGIN=https://app.example.com
```

`OS_TRUSTED_ORIGINS` is auth's own list — the origins it accepts for
its callbacks and CSRF checks — and it admits nothing to CORS. Auth
also trusts every origin listed in `OS_CORS_ORIGIN`, so that one
variable covers a cross-origin front-end that signs in. A list given
through the plugin's `cors.origins` option instead is not seen by
auth, so such a front-end is then also named in `OS_TRUSTED_ORIGINS`.

Composing the Hono adapter yourself, `createHonoApp` answers by the
same rule — the table above holds for it too, with its own `cors.origin`
option in place of `cors.origins` — so with no list it admits no
cross-origin caller. Name the origins there:

```ts
import { createHonoApp } from '@objectstack/hono';

const app = createHonoApp({
    kernel,
    prefix: '/api/v1',
    cors: {
        origin: ['https://app.example.com'],
        credentials: true,
    },
});
```

Do **not** use `origin: '*'` with `credentials: true`: together they
admit every origin for credentialed requests. Both doors refuse the
combination, and a pattern whose host part is the bare `*` with it —
`HonoServerPlugin` at boot, `createHonoApp` when the app is created;
such an entry is accepted only with credentials off
(`OS_CORS_CREDENTIALS=false`), for an API that takes no cookies, and
auth never trusts it from `OS_CORS_ORIGIN`.

## Auditing

Run the production hardening checklist before each release:

- [ ] `securityHeaders` enabled (curl any endpoint, confirm CSP/XCTO/HSTS)
- [ ] HSTS turned on after TLS is verified
- [ ] `server.security.rateLimit` enabled with a sized budget; `server.trustProxy`
      matches the topology (`true` only behind a proxy that overwrites
      `X-Forwarded-For`); multi-node: the `cache` service is shared
- [ ] `revokeSessionsOnPasswordReset: true`
- [ ] CORS origin list is explicit, not `*`
- [ ] `enforceProjectMembership: true` on scoped routes
- [ ] `osv-scanner --lockfile=pnpm-lock.yaml` clean (npm retired the
      `pnpm audit` endpoint — see issue #2974; CI enforces this via OSV-Scanner)
- [ ] `pnpm outdated` reviewed
- [ ] Backups: restore tested in the last 30 days
- [ ] Audit log: `sys_audit_log` is append-only at the DB level
