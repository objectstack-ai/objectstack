---
'@objectstack/runtime': major
---

The `/auth` domain no longer fabricates a login. With no auth service registered it answers **501**; the mock that answered 200 with a made-up session is deleted (#4113).

`packages/runtime/src/domains/auth.ts` carried a `mockAuthFallback` that answered `POST /auth/sign-up/email`, `/register`, `/sign-in/email`, `/login`, `GET /get-session` and `POST /sign-out` with **200 and a fabricated user plus a 24-hour `mock_token_*` session — for any email and any password, which was never read**. It shipped in `@objectstack/runtime` rather than behind a dev-only plugin, and gated on nothing but an empty `auth` slot, so `os serve --preset minimal` and any embedder that mounts the dispatcher without `@objectstack/plugin-auth` served it.

It was never a bypass: no session store backs the token, so `resolve-execution-context.ts` still resolved anonymous and `shouldDenyAnonymous` still denied data access. It was worse in a different way — it told the client the one thing a server must never lie about, that it had authenticated someone, while discovery simultaneously reported `auth: unavailable` and advertised no `routes.auth`. Its stated justification ("MSW/browser-only environments") had no consumer in this repository or in `objectui`, whose auth tests mock at the HTTP client layer; the only things pinning it were tests asserting the mock itself.

ADR-0115 retired this whole class of fabricating fallback inside `plugin-dev`. This was its last surviving member and the only one that shipped to production; the lineage before it — the #3891 analytics shim, #4000's dev stub, the three in #4058/#4086, #4126's security trio — was retired the same way: deleted, not put behind a flag.

**501 rather than 404**, following `/i18n`, the nearest precedent in shape: a core capability, a dispatcher-owned domain, an optional plugin behind it, and a route discovery already declines to advertise when the slot is empty. The route is mounted; what is missing is the implementation behind it — which is what 501 states and 404 would misdescribe. A wrong-shaped occupant (a service without the contract's `handleRequest`) takes the same 501, which is the sharper case: the slot is filled, so discovery advertises `routes.auth`, and that request previously got a fabricated session.

FROM → TO: a deployment without an auth service now gets `501 "Auth service not available — register @objectstack/plugin-auth to enable authentication"` on `/api/v1/auth/*` instead of a 200 carrying a session that never worked. Install `@objectstack/plugin-auth` (it is in the default `os serve` preset), or treat the absence as production already required — the 200 never produced a session the identity path accepted, so no working flow depended on it. Front-ends that mocked auth through this fallback should mock at the HTTP client layer or with an MSW handler, as `objectui` already does.
