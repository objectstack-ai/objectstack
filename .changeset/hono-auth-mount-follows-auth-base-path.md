---
"@objectstack/hono": minor
"@objectstack/plugin-auth": minor
---

`createHonoApp` mounts the auth surface where the auth service actually serves, and refuses a prefix it cannot serve it under.

The documented embed did not reach better-auth at all. `createHonoApp` mounted `/auth/*` under its own `prefix` (default `/api`) while `AuthPlugin` configures better-auth with `basePath: '/api/v1/auth'`, so the two never intersected. The forwarded request could only 404, that 404 fell through to the terminal dispatcher catch-all, and the caller got a `200` with an empty body. Measured on a real kernel with `AuthPlugin`, driving `createHonoApp({ kernel })` with both defaults untouched:

```
POST /api/auth/sign-in/email   (valid shape, wrong password)  ->  200  {}
GET  /api/auth/get-session                                    ->  200  {}
POST /api/auth/sign-up/email                                  ->  200  {}
```

A failed sign-in answering `200 {}` is the silent-success shape: a client that reads `res.ok` sends the user into an authenticated view with no session. The same boot now answers, through the same embed:

```
POST /api/v1/auth/sign-in/email  (wrong password)  ->  401  {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
GET  /api/v1/auth/get-session                      ->  200  null
POST /api/v1/auth/delete-user                      ->  401  {"message":"Unauthorized","code":"UNAUTHORIZED"}
```

**Neither default moves.** `prefix` still defaults to `/api` and the auth `basePath` still defaults to `/api/v1/auth`. What changed is which of the two decides the mount:

- **`@objectstack/hono`** — the `/auth/*` mount is derived from the auth service's configured `basePath`, read at app-construction time, rather than from `prefix`. An auth service that does not expose its base path keeps the previous `${prefix}/auth` mount, so a custom or older auth service is unaffected.
- **`@objectstack/hono`** — a `prefix` the auth base path is not inside now **refuses at construction**, naming both values and the one-line fix in either direction. Previously that composition served auth outside the namespace the host asked for while `${prefix}/auth/*` answered `200 {}`. This is the one behaviour that can stop an app booting: a deployment passing, say, `prefix: '/custom'` alongside the default auth base path was already not serving auth, and now says so instead of failing silently.
- **`@objectstack/plugin-auth`** — `AuthManager.getBasePath()` is new and public: it returns the normalised base path better-auth is configured with. It is now the single definition of that value — `createAuthInstance` hands better-auth exactly this string and the route-ownership walk reads the same call, where previously two sites normalised it independently and disagreed on a configured value written without a leading slash.
