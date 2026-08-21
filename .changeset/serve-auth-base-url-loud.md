---
"@objectstack/cli": patch
---

**Bug fix (silent failure made loud):** `serve` now prints a boot-time diagnostic when the configured auth base URL cannot be parsed, instead of discarding the failure in an empty `catch` (#10202).

The base URL was resolved through a `??` chain and parsed inside `try { new URL(baseUrl) } catch { /* ignore malformed baseUrl */ }`. That catch was the only place in the boot that learned the value was unusable, and it threw the knowledge away: the deployment's own origin never reached the `trustedOrigins` allow-list, boot continued normally, and the operator's first news of it was a browser-side `403 INVALID_ORIGIN` that names neither the variable nor the value.

The shape that reaches it is ordinary env plumbing. `readEnvWithDeprecation` returns the preferred variable whenever it is `!== undefined`, so a **present-but-empty** variable resolves to `''` rather than `undefined`; `??` falls through only on `null`/`undefined`, so `OS_AUTH_URL=` on its own line in an env file (or a Helm/systemd/CI template rendering an absent key) consults neither `OS_BASE_URL` nor the `http://localhost:<port>` default; and `new URL('')` throws.

Measured on a real `os serve` boot with `NODE_ENV=production`, `OS_AUTH_URL=` set-but-empty and `OS_TRUSTED_ORIGINS` / `OS_ROOT_DOMAIN` / preview mode unset, probing `POST /api/v1/auth/sign-in/email` so a trusted origin answers `401 INVALID_EMAIL_OR_PASSWORD` and an untrusted one `403 INVALID_ORIGIN`:

| Origin | `OS_AUTH_URL=` (empty) | `OS_AUTH_URL=https://app.example.com` | unset |
| --- | --- | --- | --- |
| `https://app.example.com` | 403 | **401** | 403 |
| `http://localhost:<port>` | **401** | 403 | **401** |
| `http://tenant.localhost:<port>` | **401** | 403 | 403 |
| `/api/v1/health`, `/api/v1/ready` | 200 | 200 | 200 |

Two corrections to how this was expected to behave, both from that table. The allow-list does **not** come out empty: `serve` passes `trustedOrigins.length ? trustedOrigins : undefined`, and `AuthManager` substitutes a localhost wildcard trio for an absent list — so better-auth receives a non-empty list and localhost origins are trusted. Which makes set-but-empty strictly **more permissive than unset**: `http://tenant.localhost:<port>` is trusted in the empty case and refused in the unset case, so an env template that renders an absent key to the empty string silently widens a production CSRF allow-list.

**What changed is only what is said, never what is resolved.** The precedence chain, its order, and the `${protocol}//${host}` origin spelling are byte-for-byte identical; a set-but-empty `OS_AUTH_URL` still stops the chain exactly as before. Treating empty as unset inside the shared `readEnvWithDeprecation` would change behaviour for every caller of that helper and remains a separate, deliberate decision. The diagnostic is a warning, not a refusal to boot: a deployment running set-but-empty today keeps starting, and now says why authentication will not work.

The resolution is exported as a seam — `resolveAuthBaseUrl()` and `formatUnusableAuthBaseUrlDiagnostic()`, alongside this file's sibling helpers — so the behaviour is reachable from tests without booting a server.
