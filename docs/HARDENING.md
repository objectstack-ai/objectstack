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
| Token-bucket rate limit                | Off (opt-in)          | `RateLimiter` primitive        |
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

The runtime exposes a token-bucket primitive but does **not** auto-wire
it into the dispatcher plugin. Reason: in-memory limits behave poorly
behind a load balancer without sticky sessions, so the decision to
enable belongs at the adapter layer where you know your topology.

```ts
import { RateLimiter, DEFAULT_RATE_LIMITS } from '@objectstack/runtime';

const auth  = new RateLimiter(DEFAULT_RATE_LIMITS.auth);   //  10 req / min / IP
const write = new RateLimiter(DEFAULT_RATE_LIMITS.write);  //  60 req / min / IP
const read  = new RateLimiter(DEFAULT_RATE_LIMITS.read);   // 600 req / min / IP
```

### Hono recipe

```ts
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { objectStackMiddleware } from '@objectstack/hono';
import { RateLimiter, DEFAULT_RATE_LIMITS } from '@objectstack/runtime';

const app = new Hono();
app.use('*', secureHeaders());   // CSP / X-Content-Type-Options / X-Frame-Options / …

const buckets = {
    auth:  new RateLimiter(DEFAULT_RATE_LIMITS.auth),
    write: new RateLimiter(DEFAULT_RATE_LIMITS.write),
    read:  new RateLimiter(DEFAULT_RATE_LIMITS.read),
};

// Rate-limit BEFORE the dispatcher middleware so rejected requests never reach it.
app.use('/api/v1/*', async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const bucket = c.req.path.startsWith('/api/v1/auth/') ? 'auth'
                 : ['POST','PUT','PATCH','DELETE'].includes(c.req.method) ? 'write'
                 : 'read';
    const decision = buckets[bucket].consume(`${ip}:${bucket}`);
    c.header('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
        c.header('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)));
        return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
});

app.use('/api/v1/*', objectStackMiddleware(kernel));   // dispatcher last
export default app;   // Cloudflare Workers / Bun / Deno / Node (@hono/node-server)
```

For multi-instance deploys, replace the default `MemoryStore` with a
Redis-backed `RateLimitStore` implementation. The interface is small —
`get(key) / set(key, state) / prune(olderThanMs)` — so a 30-line Redis
wrapper is enough.

### Trust the proxy or don't

The dispatcher's default key extractor reads `x-forwarded-for[0]`, which
is **only safe** if your edge proxy strips client-supplied values and
sets its own. If you can't guarantee that, override `keyFn` to use the
socket address:

```ts
new RateLimiter(DEFAULT_RATE_LIMITS.auth, {
    // ...
});
// then in your hook:
const key = req.socket.remoteAddress;   // ignore X-Forwarded-For
```

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

CORS is intentionally **not** opinionated by the runtime — it's an
app-level policy that depends on which origins host your front-end.
Configure it on the Hono adapter:

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

Do **not** use `origin: '*'` with `credentials: true` — the
combination is rejected by every modern browser anyway, but the
misconfiguration is a common red flag in audits.

## Auditing

Run the production hardening checklist before each release:

- [ ] `securityHeaders` enabled (curl any endpoint, confirm CSP/XCTO/HSTS)
- [ ] HSTS turned on after TLS is verified
- [ ] Rate limit wired at the adapter, with `trust proxy` configured correctly
- [ ] `revokeSessionsOnPasswordReset: true`
- [ ] CORS origin list is explicit, not `*`
- [ ] `enforceProjectMembership: true` on scoped routes
- [ ] `pnpm audit` clean (no `high`/`critical`)
- [ ] `pnpm outdated` reviewed
- [ ] Backups: restore tested in the last 30 days
- [ ] Audit log: `sys_audit_log` is append-only at the DB level
