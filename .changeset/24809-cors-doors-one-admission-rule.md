---
'@objectstack/plugin-hono-server': minor
'@objectstack/hono': minor
'@objectstack/plugin-auth': minor
---

fix(cors)!: every CORS door reads one admission rule; a loopback origin beside a list is admitted on a development boot only; an all-host pattern is refused with credentials, as `'*'` is

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a narrowing of CORS admission at three doors plus a boot refusal of one more configuration class: no authorable metadata key, spelling, type or stored shape moves, so `objectstack migrate meta` has nothing to rewrite. The remedy is a deployment variable or the door's own origin option, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers these doors (not already-registered); and the change is an admission verdict, not an interface, a type or an export retirement (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** — an admission narrowing at three doors, shipped as `minor` under the launch-window convention for accept-set narrowings. The governing text is `docs/HARDENING.md` § CORS: never `'*'` with credentials, and an explicit origin list. It finishes what the `HonoServerPlugin` default change in this release began.

- **One rule.** `@objectstack/plugin-hono-server` exports `resolveCorsAdmission`, and both transport doors read it: `HonoServerPlugin` (the server `os serve`, `os dev` and `os start` mount) and `@objectstack/hono`'s `createHonoApp`. One configuration now gets one answer at both.
- **`createHonoApp`, before.** With no origin list (no `cors.origin` option and no `OS_CORS_ORIGIN`), every origin was admitted for credentialed cross-origin requests, and a configured `'*'` with credentials on was accepted the same way. **Now** it answers as `HonoServerPlugin` does: no list admits no cross-origin caller (a loopback origin excepted, on a development boot), and `'*'` with credentials on is refused when the app is created.
- **Loopback beside a list, before.** A configured list also admitted every loopback origin (`localhost`, `127.0.0.1`, `[::1]`, any port), in every mode, at both doors that used the pattern matcher. **Now** that happens on a development boot only (`NODE_ENV` exactly `development`, read through `isDevelopmentBoot` from `@objectstack/core`). Elsewhere a list admits what it names; a list that names `http://localhost:*` still admits it. `matchOriginPattern` now matches the pattern and nothing else, and `createOriginMatcher` takes an optional `{ developmentBoot }`, read from `NODE_ENV` when the matcher is created if it is not passed, so a consumer that applies the matcher outside the Hono pipeline answers as the doors do on the same boot.
- **All-host patterns, before.** Only a literal `'*'` was refused with credentials. **Now** a pattern whose host part is the bare `*` (`https://*`, `*://*`, `http://*:*`; `isAllHostOriginPattern`) is refused with credentials at both transport doors exactly as `'*'` is, and the message names the entry.
- **Auth's trusted origins, before.** `@objectstack/plugin-auth` tested the whole `OS_CORS_ORIGIN` value against `'*'` and then split it, so a `'*'` entry among real origins, or an all-host pattern, entered better-auth's trusted origins. **Now** each entry is judged on its own, and an entry that admits every host never enters the trusted set.
- **Unchanged.** Same-origin requests need no CORS answer. An exact origin or a pattern that names part of the host (`https://*.example.com`) is admitted as before, credentials included. `'*'` with credentials off is still served. `cors: false` and `OS_CORS_ENABLED=false` still disable the middleware. Headers, methods and max-age are unchanged. `OS_TRUSTED_ORIGINS` still admits nothing to CORS.

**What an operator does.** A host composing `createHonoApp` for a cross-origin front-end names its origins, in `OS_CORS_ORIGIN` or the `cors.origin` option. A deployment that reached the server from a loopback origin outside development names that origin in its list. A list holding `'*'` or an all-host pattern while credentials are on either names its origins or sets `OS_CORS_CREDENTIALS=false`.
