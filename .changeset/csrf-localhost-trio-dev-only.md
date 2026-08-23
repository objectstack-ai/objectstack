---
"@objectstack/plugin-auth": patch
---

Gate the localhost trusted-origin substitution to non-production (#10366).

`AuthManager`'s `trustedOrigins` block substituted a localhost wildcard trio
(`http://localhost:*`, `http://*.localhost:*`, `https://*.localhost:*`) whenever
the resolved trusted-origin list came out empty and `OS_CORS_ORIGIN` was unset
or `*`. Its own comment described this as a development convenience, but the
condition tested only emptiness — it carried no `NODE_ENV` term, no dev-mode
term, nothing. A production deployment that reached it with an empty list
CSRF-trusted every `localhost` and `*.localhost` origin. The declared boundary
and the enforced boundary disagreed, and only the declared one was visible in
the file.

The substitution is now gated on `NODE_ENV !== 'production'`, the same dev
signal already used by the fallback auth secret and by the dev `Origin`
synthesis in the same file. The property enforced: **a development convenience
exists only outside production.**

**What production receives instead.** With the trio gated off and the list
empty, the block's tail omits `trustedOrigins` from the better-auth config
entirely. That is not an absent policy. Measured against the installed
better-auth 1.7.1: `getTrustedOrigins`
(`dist/context/helpers.mjs`) unconditionally seeds the trusted set from the
resolved `baseURL` origin and treats `options.trustedOrigins` as purely
**additive**, so an omitted key and an empty array are equivalent — both leave
exactly the deployment's own origin trusted, and `validateOrigin`
(`dist/api/middlewares/origin-check.mjs`) refuses everything else with
`403 INVALID_ORIGIN`.

**Who is affected.** Deployments with an explicitly configured `trustedOrigins`,
or one derived from `OS_CORS_ORIGIN`, are unchanged in production — the
substitution never fired for them. Non-production behaviour is unchanged,
including under `NODE_ENV=test` and when `NODE_ENV` is unset. A production
deployment that was relying on the substitution to reach its own login page
now receives a loud `403` rather than silent over-trust; the remedy is to set
`OS_TRUSTED_ORIGINS`, or to fix the base URL that resolved unusable (PR #10369's
boot diagnostic already names that condition at startup).

Both existing pins keep their dev-only assertions verbatim; new pins cover the
production omission, the non-production legs, the SSO per-request-function
shape, and — load-bearing — that explicitly configured and `OS_CORS_ORIGIN`-derived
trust survives in production.
