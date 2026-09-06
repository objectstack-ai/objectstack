---
"@objectstack/runtime": patch
---

The `/auth` dispatcher domain no longer claims sibling namespaces such as `/authx` and `/authentication/foo`.

`createAuthDomain` registered `{ prefix: '/auth' }` without a `match`, and `DomainRoute.match` defaults to `'prefix'` — a bare `path.startsWith('/auth')` with no segment boundary. Every path whose first segment merely *began* with the five characters `auth` was therefore claimed by the auth domain and forwarded to the auth service, instead of falling through to the dispatcher's `ROUTE_NOT_FOUND`. Measured on a real boot (a real kernel with `AuthPlugin`, served through `createHonoApp({ kernel, prefix: '/api/v1' })`), `GET /api/v1/authx`, `/api/v1/authx/foo` and `/api/v1/authentication/foo` were all claimed; `/api/v1/aut/foo` and `/api/v1/zzz/foo` were not, which is what located the boundary at the `auth` prefix.

The route now declares `match: 'segment'` — the spelling the registry's other boundary-correct domains (`/keys`, `/mcp`, `/mcp/skill`) already use. It claims `/auth` exactly and everything under `/auth/`, and nothing else.

**What does not change.** `/auth/me/permissions` and `/auth/me/localization` still reach `dispatch()`. Neither is a better-auth endpoint, so the adapter's `/auth/*` mount disclaims them and they arrive at this domain; `'segment'` keeps claiming them, which the accompanying test pins as an overshoot control alongside the three narrowed rows.

**If you mounted a namespace under `/authx`, `/authentication`, or any other first segment starting with `auth`,** it was previously shadowed by the auth domain and answered by the auth service. It is now reachable — register a domain handler for it, or expect `ROUTE_NOT_FOUND`.
