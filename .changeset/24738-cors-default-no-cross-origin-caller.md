---
'@objectstack/plugin-hono-server': minor
---

fix(plugin-hono-server)!: the CORS default admits no cross-origin caller, and `'*'` with credentials is refused at boot

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a narrowing of the transport's CORS admission default plus a boot refusal of one configuration: no authorable metadata key, spelling, export, type or stored shape moves, so `objectstack migrate meta` has nothing to rewrite. The remedy is a deployment variable, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is an admission verdict, not an interface, a type or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** — an admission narrowing of the transport's CORS answer, shipped as `minor` under the launch-window convention for accept-set narrowings. The governing text is `docs/HARDENING.md` § CORS: never `'*'` with credentials, and an explicit origin list.

- **Before.** With no origin list configured (no `cors.origins` option and no `OS_CORS_ORIGIN`), the CORS middleware admitted every origin for credentialed cross-origin requests. A configured `'*'` with credentials on was accepted and answered the same way.
- **Now.** With no list, no cross-origin caller is admitted. A loopback origin (`localhost`, `127.0.0.1`, `[::1]`, any port) is admitted on a development boot only: `NODE_ENV` exactly `development`, which `os dev` and `os serve --dev` set. A list that contains `'*'` while credentials are on is refused in `init()`, so the boot fails, and the message names both remedies.
- **Unchanged.** Same-origin requests need no CORS answer, so the Console under `/_console` and every page the server itself serves work as before. A configured list, exact origins or wildcard patterns, is admitted exactly as before, credentials included. `'*'` with credentials off still boots. `cors: false` and `OS_CORS_ENABLED=false` still disable the middleware. Allowed and exposed headers, methods and max-age are unchanged.

**What an operator does.** A front-end served from another origin that calls this server is now named: `OS_CORS_ORIGIN=https://app.example.com` (comma-separated for several), or the plugin's `cors.origins` option. A boot that now refuses `'*'` either names its origins or sets `OS_CORS_CREDENTIALS=false` to keep serving `'*'` without credentials. `OS_TRUSTED_ORIGINS`, auth's callback and CSRF list, admits nothing to CORS: a cross-origin front-end that signs in belongs in both lists.
